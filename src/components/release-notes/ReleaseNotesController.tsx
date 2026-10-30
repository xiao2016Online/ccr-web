import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { runtime } from "@/runtime";
import { useMarkReleaseNotesSeen, useReleaseNotes } from "@/hooks/useReleaseNotes";
import { useSettings } from "@/hooks/useSettings";
import type { ReleaseNotesDto, VersionNotes } from "@/types";
import { ReleaseNotesDialog, type ReleaseNotesMode } from "./ReleaseNotesDialog";
import { useOnboardingState } from "@/components/onboarding/useOnboardingState";

interface DialogCtx {
  /** 侧栏入口: 当前版本展开 + 更早的版本 */
  openManual: () => void;
  /** 弹窗开着时的模式; 关着为 null (侧栏入口据此显示选中态) */
  openMode: ReleaseNotesMode | null;
  hasUnread: boolean;
  /** 有没有任何内嵌说明; 没有就不显示入口 */
  hasNotes: boolean;
  current: string | null;
}

const ReleaseNotesContext = createContext<DialogCtx>({
  openManual: () => {},
  openMode: null,
  hasUnread: false,
  hasNotes: false,
  current: null,
});

export const useReleaseNotesDialog = () => useContext(ReleaseNotesContext);

interface View {
  mode: ReleaseNotesMode;
  main: VersionNotes;
  others: VersionNotes[];
}

/** 打开时拍一份快照: 弹窗开着期间即使另一端标记已读 (unseen 变空) 也不会被抽掉内容 */
function snapshot(data: ReleaseNotesDto, mode: ReleaseNotesMode): View | null {
  const list = mode === "auto" ? data.versions.filter((v) => data.unseen.includes(v.version)) : data.versions;
  const [main, ...others] = list;
  return main ? { mode, main, others } : null;
}

/**
 * 「更新内容」弹窗的调度 (spec §5.2): 桌面端、onboarding 已完成、有未读时, 本进程自动弹一次;
 * 关闭 (× / 知道了 / Esc / 点遮罩) 时才标记已读。侧栏入口经 context 打开同一个弹窗。
 */
export function ReleaseNotesProvider({ children }: { children: ReactNode }) {
  const { data } = useReleaseNotes();
  // 引导窗口没走完时不弹, 免得两个弹窗叠在一起
  const onboarding = useOnboardingState();
  // 等设置加载完再自动弹: 弹窗的初始语言标签取自 preferred_language, 否则会先按系统语言选错
  const settings = useSettings();
  const mark = useMarkReleaseNotesSeen();
  const [view, setView] = useState<View | null>(null);
  // 每次打开换 key, 让弹窗重新挂载: 语言标签回到界面语言、折叠行全部收起
  const [openCount, setOpenCount] = useState(0);
  const autoShown = useRef(false);
  const hasUnread = (data?.unseen.length ?? 0) > 0;

  useEffect(() => {
    if (autoShown.current || !data || runtime.kind !== "desktop") return;
    if (!settings.isSuccess || !onboarding.data?.completed || data.unseen.length === 0) return;
    const v = snapshot(data, "auto");
    if (!v) return;
    autoShown.current = true;
    setView(v);
    setOpenCount((n) => n + 1);
  }, [data, onboarding.data, settings.isSuccess]);

  const openManual = () => {
    if (!data) return;
    const v = snapshot(data, "manual");
    if (!v) return;
    setView(v);
    setOpenCount((n) => n + 1);
  };

  const close = () => {
    if (hasUnread) {
      mark.mutate(undefined, { onError: (e) => console.warn("mark_release_notes_seen failed", e) });
    }
    setView(null);
  };

  const ctx: DialogCtx = {
    openManual,
    openMode: view?.mode ?? null,
    hasUnread,
    hasNotes: (data?.versions.length ?? 0) > 0,
    current: data?.current ?? null,
  };

  return (
    <ReleaseNotesContext.Provider value={ctx}>
      {children}
      {view && (
        <ReleaseNotesDialog
          key={openCount}
          open
          onClose={close}
          mode={view.mode}
          main={view.main}
          others={view.others}
        />
      )}
    </ReleaseNotesContext.Provider>
  );
}
