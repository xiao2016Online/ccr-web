import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Minus } from "lucide-react";
import { api } from "@/api/tauri";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errorText";
import { filledTierCount, isLocale } from "@/lib/onboardingFlow";
import { providerName } from "@/lib/providerText";
import { useSettings } from "@/hooks/useSettings";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { StarPrompt } from "@/components/StarPrompt";
import type { Wizard } from "../wizardStore";
import { useStepFooter } from "../stepFooter";
import { useConnectOutcome } from "../connectOutcome";
import { ONBOARDING_STATE_KEY } from "../useOnboardingState";
import { NATIVE } from "./AppearanceStep";

/** 完成页的去处: 设置页的分组 id 见 Settings.tsx 的 TAB_IDS (开机自启在「通用」)。 */
const NEXT_LINKS: { key: string; to: string }[] = [
  { key: "addMore", to: "/subscriptions/new" },
  { key: "dispatch", to: "/virtual-models" },
  { key: "live", to: "/live-routing" },
  { key: "webUi", to: "/settings?tab=webtui" },
  { key: "tui", to: "/settings?tab=webtui" },
  { key: "autostart", to: "/settings" },
];

/** 第 6 步: 三项摘要 + 接下来可以去哪 + 求 Star; 「开始使用」或点任一去处都会标记引导完成。 */
export function DoneStep({ wizard }: { wizard: Wizard }) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const settings = useSettings();
  const subs = useSubscriptions();
  const { claude } = useConnectOutcome();
  const { state, reset } = wizard;
  const [error, setError] = useState<string | null>(null);

  async function finish(): Promise<boolean> {
    setError(null);
    try {
      await api.completeOnboarding();
      await qc.invalidateQueries({ queryKey: ONBOARDING_STATE_KEY });
      reset();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  useStepFooter({ canNext: true, nextLabel: t("onboarding.wizard.finish"), onNext: finish });

  // 只有显式选了四种语言之一才显示该语言; system 与未知值 (手改配置等) 都按「跟随系统」显示当前语言
  const pref = settings.data?.preferred_language;
  const langValue = isLocale(pref)
    ? NATIVE[pref].name
    : `${t("onboarding.wizard.appearance.followSystem")} · ${NATIVE[locale].name}`;

  const sub = subs.data?.find((s) => s.id === state.subscriptionId);
  let subValue: string | null = null;
  if (state.source === "import" && state.importedCount) {
    subValue = t("onboarding.wizard.done.imported", { n: state.importedCount });
  } else if (sub) {
    subValue = `${providerName(sub, locale)} · ${t("onboarding.wizard.done.tiers", { n: filledTierCount(sub.model_slots) })}`;
  }

  const toolValue =
    claude === "written"
      ? t("onboarding.wizard.done.claudeWritten")
      : claude === "manual"
        ? t("onboarding.wizard.done.claudeManual")
        : null;

  const rows = [
    { label: t("onboarding.wizard.appearance.language"), value: langValue },
    { label: t("onboarding.wizard.done.subscription"), value: subValue ?? t("onboarding.wizard.done.notAdded") , ok: !!subValue },
    { label: t("onboarding.wizard.route.tools"), value: toolValue ?? t("onboarding.wizard.done.toolLater"), ok: !!toolValue },
  ];

  return (
    <div className="ob-stack">
      <p className="ob-hooray">{t("onboarding.wizard.done.hooray")}</p>
      <div className="ob-summary">
        {rows.map((r) => (
          <div key={r.label} className="ob-summary-row">
            <span className={cn("ob-summary-mark", r.ok === false && "pending")} aria-hidden="true">
              {r.ok === false ? <Minus size={12} strokeWidth={2.6} /> : <Check size={12} strokeWidth={2.6} />}
            </span>
            <span className="ob-summary-label">{r.label}</span>
            <span className="ob-summary-value">{r.value}</span>
          </div>
        ))}
      </div>
      <span className="ob-h">{t("onboarding.wizard.done.nextUp")}</span>
      <div className="ob-next-grid">
        {NEXT_LINKS.map((l) => (
          <button
            key={l.key}
            type="button"
            className="ob-next-card"
            onClick={() => void finish().then((ok) => ok && navigate(l.to))}
          >
            <span className="ob-next-text">
              <span className="ob-next-title">{t(`onboarding.wizard.done.link.${l.key}`)}</span>
              <span className="ob-next-where">{t(`onboarding.wizard.done.where.${l.key}`)}</span>
            </span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
      {error && <p className="ob-error" role="alert">{error}</p>}
      <StarPrompt className="ob-star" />
    </div>
  );
}
