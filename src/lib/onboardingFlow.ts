/**
 * 首次启动引导窗口的流程规则 (纯函数, 不碰 DOM / 存储 / 网络)。
 * 由 scripts/check-onboarding.mjs 直接 import 校验, 所以只能 import 类型。
 */
import type { Locale } from "@/i18n/localeTag";
import type { AuthType, ModelSlots, ProviderEndpointInfo, ProviderInfo } from "@/types";

export const ONBOARDING_STEPS = [
  "appearance",
  "terms",
  "subscription",
  "models",
  "connect",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** 当前订阅从哪来: 窗口里建的 / 完整添加页建的 / 从备份导入的 */
export type WizardSource = "wizard" | "page" | "import";

/** 存在 localStorage 里的引导进度。刻意不含任何凭据 —— API Key 只活在组件 state 里。 */
export interface WizardPersisted {
  step: OnboardingStep;
  subscriptionId: string | null;
  source: WizardSource | null;
  importedCount: number | null;
  /** 第 4 步「下一步」已把本窗口建的订阅定稿 (写槽位 + 并入虚拟模型); 之前换连接信息时旧订阅可删 */
  confirmed: boolean;
  /** 用户点了「稍后再设置」: 不再自动弹出, 侧栏给继续入口 */
  dismissed: boolean;
  /** 从设置页主动重新打开 (已完成引导的用户也显示) */
  reopened: boolean;
}

export const WIZARD_STORAGE_KEY = "cc-router.onboarding-wizard";
export const DISCLAIMER_FLAG_KEY = "cc-router.disclaimer-accepted";

export const DEFAULT_WIZARD: WizardPersisted = {
  step: "appearance",
  subscriptionId: null,
  source: null,
  importedCount: null,
  confirmed: false,
  dismissed: false,
  reopened: false,
};

const SOURCES: readonly WizardSource[] = ["wizard", "page", "import"];

/** 解析存档; 坏 JSON / 类型不对的字段逐个回落默认值, 未知字段丢弃。 */
export function parseWizardState(raw: string | null): WizardPersisted {
  if (!raw) return { ...DEFAULT_WIZARD };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_WIZARD };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULT_WIZARD };
  const o = v as Record<string, unknown>;
  return {
    step: ONBOARDING_STEPS.includes(o.step as OnboardingStep)
      ? (o.step as OnboardingStep)
      : DEFAULT_WIZARD.step,
    subscriptionId: typeof o.subscriptionId === "string" ? o.subscriptionId : null,
    source: SOURCES.includes(o.source as WizardSource) ? (o.source as WizardSource) : null,
    importedCount:
      typeof o.importedCount === "number" && Number.isFinite(o.importedCount) ? o.importedCount : null,
    confirmed: o.confirmed === true,
    dismissed: o.dismissed === true,
    reopened: o.reopened === true,
  };
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

type FlowPos = Pick<WizardPersisted, "step" | "source">;

/** 槽位已在别处选好 (完整添加页 / 备份导入) 时, 「选模型」一步前后都跳过。 */
function skipped(step: OnboardingStep, source: WizardSource | null): boolean {
  return step === "models" && source !== null && source !== "wizard";
}

function walk(pos: FlowPos, delta: 1 | -1): OnboardingStep | null {
  let i = stepIndex(pos.step) + delta;
  while (i >= 0 && i < ONBOARDING_STEPS.length) {
    const s = ONBOARDING_STEPS[i];
    if (!skipped(s, pos.source)) return s;
    i += delta;
  }
  return null;
}

export function nextStep(pos: FlowPos): OnboardingStep | null {
  return walk(pos, 1);
}

export function prevStep(pos: FlowPos): OnboardingStep | null {
  return walk(pos, -1);
}

/** 同意免责声明之后才允许「稍后再设置」。 */
export function canSkip(disclaimerAccepted: boolean): boolean {
  return disclaimerAccepted;
}

export function isWizardVisible(a: {
  completed: boolean | undefined;
  dismissed: boolean;
  reopened: boolean;
  pathname: string;
}): boolean {
  // 完整添加页本身就是引导的一段 (OAuth / 自定义), 那时窗口让位
  if (a.pathname === "/subscriptions/new") return false;
  return a.reopened || (a.completed === false && !a.dismissed);
}

const PENDING_SLOT = "(pending)";

/**
 * 只删本窗口建的、还没在第 4 步确认的订阅; 别处来的订阅一律不动。
 * 不按槽位是否还是占位值判断: 第 4 步「测试连接」会先写真实槽位, 而 Key 填错正是最常见的退回原因。
 */
export function canDiscardSubscription(a: { source: WizardSource | null; confirmed: boolean }): boolean {
  return a.source === "wizard" && !a.confirmed;
}

/** 完成页摘要里的「N 个档位」: 空的与占位的都不算。 */
export function filledTierCount(slots: ModelSlots): number {
  const { fable, opus, sonnet, haiku } = slots;
  return [fable, opus, sonnet, haiku].filter((s) => s.trim() !== "" && s !== PENDING_SLOT).length;
}

const LOCALES: readonly Locale[] = ["zh", "zh-Hant", "en", "ja"];

/** settings.preferred_language 是后端的自由字符串 (手改配置 / 未来版本的备份), 用前先确认是已知语言。 */
export function isLocale(v: string | undefined): v is Locale {
  return LOCALES.includes(v as Locale);
}

/** 能在窗口里直接填 API Key 添加的鉴权类型 (Anthropic 透传 + 四种翻译类)。OAuth 走完整添加页。 */
export const INLINE_AUTH_TYPES: readonly AuthType[] = [
  "api_key",
  "gemini_api_key",
  "gemini_interactions_api_key",
  "openai_responses_api_key",
  "openai_chat_completions_api_key",
];

/** 对话类端点; systemone (Jev 决策模型) 不在引导里出现。 */
export function inlineEndpoints(p: Pick<ProviderInfo, "endpoints">): ProviderEndpointInfo[] {
  return p.endpoints.filter((e) => (e.protocol ?? "messages") === "messages");
}

export function providerEntry(p: Pick<ProviderInfo, "auth" | "endpoints">): "inline" | "page" | "hidden" {
  if (inlineEndpoints(p).length === 0) return "hidden";
  return INLINE_AUTH_TYPES.includes(p.auth.type) ? "inline" : "page";
}
