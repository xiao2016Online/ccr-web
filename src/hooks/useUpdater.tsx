import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { runtime } from "@/runtime";
import {
  isAppImageRuntime,
  isLinuxPlatform,
  manifestUrlForSource,
  relaunchApp,
} from "@/lib/updater";
import { api } from "@/api/tauri";
import { useSettings } from "@/hooks/useSettings";
import type { UpdaterProgressEvent } from "@/types";
import { version as PKG_VERSION } from "../../package.json";
import { errorText } from "@/lib/errorText";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdaterProgress {
  downloaded: number;
  total: number | null;
}

/**
 * 区分两种检测结果:
 * - auto: Rust 自定义 command 完整流程 (下载 + 验签 + 安装)
 * - manual: 仅检测到新版,需用户手动下载 (Linux deb 唯一情况)
 */
export type DetectedUpdate =
  | { kind: "auto"; version: string; body?: string }
  | { kind: "manual"; version: string; body?: string };

export interface UpdaterState {
  status: UpdaterStatus;
  detected: DetectedUpdate | null;
  progress: UpdaterProgress | null;
  errorMessage: string | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
}

const UpdaterContext = createContext<UpdaterState | null>(null);

const PROGRESS_EVENT = "updater://progress";

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [detected, setDetected] = useState<DetectedUpdate | null>(null);
  const [progress, setProgress] = useState<UpdaterProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const downloadedRef = useRef(0);
  const totalRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const flushProgress = useCallback(() => {
    rafIdRef.current = null;
    setProgress({ downloaded: downloadedRef.current, total: totalRef.current });
  }, []);

  const scheduleProgressFlush = useCallback(() => {
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushProgress);
    }
  }, [flushProgress]);

  // 监听 Rust 推送的下载进度
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const fn = await runtime.listen<UpdaterProgressEvent>(PROGRESS_EVENT, (e) => {
        const payload = e.payload;
        if (payload.phase === "started") {
          totalRef.current = payload.content_length ?? null;
          downloadedRef.current = 0;
          scheduleProgressFlush();
        } else if (payload.phase === "progress") {
          downloadedRef.current += payload.chunk_length;
          scheduleProgressFlush();
        } else if (payload.phase === "finished") {
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          setProgress({
            downloaded: downloadedRef.current,
            total: totalRef.current,
          });
        }
      });
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [scheduleProgressFlush]);

  const check = useCallback(async () => {
    // 服务器 (web 运行时) 没有应用内更新, 后端对应命令是拒绝桩;
    // 直接短路, 不发请求 (否则设置页/侧栏每次轮询都是一条 400 报错)。
    if (runtime.kind !== "desktop") {
      setStatus("up_to_date");
      return;
    }
    setStatus("checking");
    setErrorMessage(null);
    try {
      const linux = isLinuxPlatform();
      if (linux && !(await isAppImageRuntime())) {
        const manual = await fetchManifestForManualCompare(
          manifestUrlForSource(settings?.update_source ?? null),
        );
        if (manual) {
          setDetected(manual);
          setStatus("available");
        } else {
          setDetected(null);
          setStatus("up_to_date");
        }
        return;
      }

      const info = await api.checkForUpdate();
      if (!info) {
        setDetected(null);
        setStatus("up_to_date");
        return;
      }
      setDetected({
        kind: "auto",
        version: info.version,
        body: info.body,
      });
      setStatus("available");
    } catch (e) {
      console.warn("[updater] check failed", e);
      setErrorMessage(errorText(e));
      setStatus("error");
    }
  }, [settings?.update_source]);

  const install = useCallback(async () => {
    if (!detected || detected.kind !== "auto") return;
    setStatus("downloading");
    downloadedRef.current = 0;
    totalRef.current = null;
    setProgress({ downloaded: 0, total: null });
    try {
      // Rust 端跑 download_and_install,进度通过 PROGRESS_EVENT 推送(上面 useEffect 监听)
      // 解压安装但 *不* 自动重启,留给用户决定时机 (cc-router 是常驻代理)
      await api.downloadInstallUpdate();
      setStatus("ready");
    } catch (e) {
      console.warn("[updater] install failed", e);
      setErrorMessage(errorText(e));
      setStatus("error");
    }
  }, [detected]);

  const restart = useCallback(async () => {
    try {
      await relaunchApp();
    } catch (e) {
      console.warn("[updater] relaunch failed", e);
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus("idle");
    setProgress(null);
    setErrorMessage(null);
  }, []);

  useEffect(
    () => () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    },
    [],
  );

  // 托盘菜单的「检查更新」一项在有新版本时换成「有新版本 vX · 查看」。
  // 检测结果只在前端有 (Linux deb 的手动比对也在这里), 所以由前端推给托盘。
  const detectedVersion = detected?.version ?? null;
  useEffect(() => {
    if (runtime.kind !== "desktop") return;
    api.setTrayUpdate(detectedVersion).catch(() => {});
  }, [detectedVersion]);

  const value = useMemo<UpdaterState>(
    () => ({
      status,
      detected,
      progress,
      errorMessage,
      check,
      install,
      restart,
      dismiss,
    }),
    [status, detected, progress, errorMessage, check, install, restart, dismiss],
  );

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

export function useUpdater(): UpdaterState {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error("useUpdater must be used within UpdaterProvider");
  }
  return ctx;
}

/**
 * 启动时自动检查一次 (settings.auto_check_updates 关闭时跳过)。
 * 必须等设置加载完再决定: 既要读开关, check 闭包也要带上正确的 update_source
 * (Linux deb 的手动比对按它选 manifest)。每次启动至多判定一次 ——
 * 运行中把开关从关切到开不会补查, 下次启动生效。
 */
export function useUpdaterAutoCheck() {
  const { check } = useUpdater();
  const { data: settings } = useSettings();
  const decidedRef = useRef(false);
  useEffect(() => {
    if (!settings || decidedRef.current) return;
    decidedRef.current = true;
    if (!settings.auto_check_updates) return;
    void check();
  }, [settings, check]);
}

async function fetchManifestForManualCompare(
  manifestUrl: string,
): Promise<DetectedUpdate | null> {
  try {
    const resp = await fetch(manifestUrl, { cache: "no-store" });
    if (!resp.ok) return null;
    const manifest = (await resp.json()) as { version: string; notes?: string };
    if (!isNewer(manifest.version, PKG_VERSION)) return null;
    return { kind: "manual", version: manifest.version, body: manifest.notes };
  } catch (e) {
    console.warn("[updater] manual manifest fetch failed", e);
    return null;
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
