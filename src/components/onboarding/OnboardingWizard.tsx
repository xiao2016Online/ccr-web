import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowRight, Check, Info } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { providerName } from "@/lib/providerText";
import {
  ONBOARDING_STEPS,
  canSkip,
  nextStep,
  prevStep,
  stepIndex,
  type OnboardingStep,
} from "@/lib/onboardingFlow";
import { getWizardState, useDisclaimerAccepted, useWizard, type Wizard } from "./wizardStore";
import { DEFAULT_FOOTER, StepFooterContext, type StepFooter } from "./stepFooter";
import { AppearanceStep } from "./steps/AppearanceStep";
import { TermsStep } from "./steps/TermsStep";
import { SubscriptionStep } from "./steps/SubscriptionStep";
import { ModelsStep } from "./steps/ModelsStep";
import { ConnectStep } from "./steps/ConnectStep";
import { DoneStep } from "./steps/DoneStep";
import { ConnectOutcomeContext, type ClaudeOutcome } from "./connectOutcome";

const TOTAL = ONBOARDING_STEPS.length;

function StepView({ step, wizard }: { step: OnboardingStep; wizard: Wizard }) {
  switch (step) {
    case "appearance":
      return <AppearanceStep wizard={wizard} />;
    case "terms":
      return <TermsStep wizard={wizard} />;
    case "subscription":
      return <SubscriptionStep wizard={wizard} />;
    case "models":
      return <ModelsStep wizard={wizard} />;
    case "connect":
      return <ConnectStep wizard={wizard} />;
    case "done":
      return <DoneStep wizard={wizard} />;
  }
}

/**
 * 首次启动引导窗口 (spec docs/superpowers/specs/2026-10-25-onboarding-wizard-design.md)。
 * 盖在主界面之上; 左栏说明随步骤换, 右栏是步骤组件, 底栏的「下一步」听步骤经 StepFooter 上报的规则。
 * Esc / 点遮罩不关窗 —— 关窗只走「稍后再设置」, 而那要先同意免责声明。
 */
export function OnboardingWizard() {
  const { t, locale } = useT();
  const wizard = useWizard();
  const { state, goTo, dismiss } = wizard;
  const step = state.step;
  const [accepted] = useDisclaimerAccepted();
  const subs = useSubscriptions();

  // 步骤上报的规则: canNext / nextLabel 进 state (驱动按钮), onNext 进 ref (总是最新闭包, 不触发重渲染)
  const footerRef = useRef<StepFooter>(DEFAULT_FOOTER);
  const [meta, setMeta] = useState<Pick<StepFooter, "canNext" | "nextLabel">>(DEFAULT_FOOTER);
  const [busy, setBusy] = useState(false);
  const [claude, setClaude] = useState<ClaudeOutcome>(null);
  const outcome = useMemo(() => ({ claude, setClaude }), [claude]);
  const setFooter = useCallback((f: StepFooter) => {
    footerRef.current = f;
    setMeta((m) => (m.canNext === f.canNext && m.nextLabel === f.nextLabel ? m : { canNext: f.canNext, nextLabel: f.nextLabel }));
  }, []);

  // 无论步骤因何改变 (翻页、步骤条、步骤内部直接 goTo), 都先清掉上一步的规则。
  // layout effect 跑在新步骤的 passive effect 之前, 所以新步骤上报的规则不会被这里覆盖
  useLayoutEffect(() => {
    footerRef.current = DEFAULT_FOOTER;
    setMeta(DEFAULT_FOOTER);
  }, [step]);

  const move = (to: OnboardingStep) => goTo(to);

  const prev = prevStep(state);

  async function handleNext() {
    if (busy || !meta.canNext) return;
    const f = footerRef.current;
    if (f.onNext) {
      setBusy(true);
      let ok = false;
      try {
        ok = await f.onNext();
      } finally {
        setBusy(false);
      }
      if (!ok) return;
    }
    // onNext 可能改了进度 (如第 3 步把来源改成本窗口), 按最新值决定去哪一步
    const target = nextStep(getWizardState());
    if (target) move(target);
  }

  const sub = subs.data?.find((s) => s.id === state.subscriptionId);
  const subLabel = sub ? providerName(sub, locale) : t("onboarding.wizard.route.sub");
  const route = useMemo(
    () => ({
      tools: step === "connect" || step === "done",
      router: step === "appearance" || step === "terms" || step === "done",
      sub: step === "subscription" || step === "models" || step === "done",
    }),
    [step],
  );

  const cur = stepIndex(step);

  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="cc-dialog-overlay ob-overlay" />
        <DialogPrimitive.Content
          className="ob"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <header className="ob-head">
            <ol className="ob-steps">
              {ONBOARDING_STEPS.map((s, i) => {
                const done = i < cur;
                const current = i === cur;
                // 被跳过的「选模型」(槽位已在完整添加页 / 备份里) 不能点回去
                const skippedStep = s === "models" && state.source !== null && state.source !== "wizard";
                return (
                  <li key={s} className="ob-step-item">
                    <button
                      type="button"
                      className={cn("ob-step", done && "done", current && "current", skippedStep && "skipped")}
                      disabled={!done || skippedStep || busy}
                      aria-current={current ? "step" : undefined}
                      onClick={() => move(s)}
                    >
                      <span className="ob-step-dot">{done && !skippedStep ? <Check size={13} strokeWidth={2.6} /> : i + 1}</span>
                      <span className="ob-step-label">{t(`onboarding.wizard.step.${s}`)}</span>
                    </button>
                    {i < TOTAL - 1 && <span className={cn("ob-step-line", done && "done")} aria-hidden="true" />}
                  </li>
                );
              })}
            </ol>
          </header>

          <div className="ob-main">
            <aside className="ob-side">
              <p className="ob-kicker">{t("onboarding.wizard.kicker", { n: cur + 1, total: TOTAL })}</p>
              <DialogPrimitive.Title className="ob-title">{t(`onboarding.wizard.${step}.title`)}</DialogPrimitive.Title>
              <p className="ob-desc">{t(`onboarding.wizard.${step}.body`)}</p>
              <div className="ob-side-spacer" />
              <div className="ob-tip">
                <Info size={15} aria-hidden="true" />
                <span>{t(`onboarding.wizard.${step}.tip`)}</span>
              </div>
              <div className="ob-route" aria-hidden="true">
                <RouteChip on={route.tools}>{t("onboarding.wizard.route.tools")}</RouteChip>
                <ArrowRight size={14} className={cn("ob-route-arrow", step === "done" && "on")} />
                <RouteChip on={route.router}>cc-router</RouteChip>
                <ArrowRight size={14} className={cn("ob-route-arrow", step === "done" && "on")} />
                <RouteChip on={route.sub}>{subLabel}</RouteChip>
              </div>
            </aside>

            <section className="ob-body" key={step}>
              <StepFooterContext.Provider value={setFooter}>
                <ConnectOutcomeContext.Provider value={outcome}>
                  <StepView step={step} wizard={wizard} />
                </ConnectOutcomeContext.Provider>
              </StepFooterContext.Provider>
            </section>
          </div>

          <footer className="ob-foot">
            <div className="ob-foot-left">
              {canSkip(accepted) && (
                <button type="button" className="ob-skip" onClick={dismiss} disabled={busy}>
                  {t("onboarding.wizard.skip")}
                </button>
              )}
              <span className="ob-counter">{cur + 1} / {TOTAL}</span>
            </div>
            <div className="ob-foot-right">
              {prev && (
                <button type="button" className="btn ghost ob-back" onClick={() => move(prev)} disabled={busy}>
                  {t("onboarding.wizard.back")}
                </button>
              )}
              <button
                type="button"
                className="btn primary ob-next"
                onClick={() => void handleNext()}
                disabled={!meta.canNext || busy}
              >
                {meta.nextLabel ?? t("onboarding.wizard.next")}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function RouteChip({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={cn("ob-chip", on && "on")}>{children}</span>;
}
