import { useMemo, useSyncExternalStore } from "react";
import {
  DEFAULT_WIZARD,
  DISCLAIMER_FLAG_KEY,
  WIZARD_STORAGE_KEY,
  parseWizardState,
  type OnboardingStep,
  type WizardPersisted,
} from "@/lib/onboardingFlow";

/**
 * 引导进度的外部 store: localStorage 持久化 + 内存缓存 + 订阅通知。
 * 刻意不放进 React context —— 完整添加页 (不在窗口里) 也要能把进度推到下一步。
 * 读写都包 try/catch: 隐私模式 / 被禁用的存储下照常工作, 只是重启后不记得进度。
 */

let cache: WizardPersisted | null = null;
let disclaimer: boolean | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function readState(): WizardPersisted {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WIZARD_STORAGE_KEY);
  } catch {
    // 存储不可用: 按全新进度处理
  }
  cache = parseWizardState(raw);
  return cache;
}

function writeState(next: WizardPersisted) {
  cache = next;
  try {
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 写不进去只影响跨重启的续接
  }
  notify();
}

function updateWizard(p: Partial<WizardPersisted>) {
  writeState({ ...readState(), ...p });
}

/** 当前进度 (非 hook): 异步回调结束后要读最新值时用, 渲染时的 state 可能已过期。 */
export function getWizardState(): WizardPersisted {
  return readState();
}

/** 给窗口之外的页面用 (完整添加页保存 / 导入之后): 跳到指定步骤并重新显示窗口。 */
export function resumeWizardAt(step: OnboardingStep, p: Partial<WizardPersisted>) {
  writeState({ ...readState(), ...p, step, dismissed: false });
}

export function useWizard() {
  const state = useSyncExternalStore(subscribe, readState);
  return useMemo(
    () => ({
      state,
      goTo: (step: OnboardingStep) => updateWizard({ step }),
      patch: updateWizard,
      dismiss: () => updateWizard({ dismissed: true, reopened: false }),
      reopen: () => updateWizard({ dismissed: false, reopened: true }),
      reset: () => writeState({ ...DEFAULT_WIZARD }),
    }),
    [state],
  );
}

export type Wizard = ReturnType<typeof useWizard>;

function readDisclaimer(): boolean {
  if (disclaimer !== null) return disclaimer;
  try {
    disclaimer = localStorage.getItem(DISCLAIMER_FLAG_KEY) === "1";
  } catch {
    disclaimer = false;
  }
  return disclaimer;
}

function writeDisclaimer(v: boolean) {
  disclaimer = v;
  try {
    if (v) localStorage.setItem(DISCLAIMER_FLAG_KEY, "1");
    else localStorage.removeItem(DISCLAIMER_FLAG_KEY);
  } catch {
    // 写失败时本次会话仍按内存值放行, 下次启动会再问一次
  }
  notify();
}

/** 免责声明是否已同意 (沿用旧全屏页的 localStorage 键, 老用户同意过的不再问)。 */
export function useDisclaimerAccepted(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(subscribe, readDisclaimer);
  return [v, writeDisclaimer];
}
