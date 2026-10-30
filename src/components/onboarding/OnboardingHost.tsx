import { useLocation } from "react-router";
import { isWizardVisible } from "@/lib/onboardingFlow";
import { useOnboardingState } from "./useOnboardingState";
import { useWizard } from "./wizardStore";
import { OnboardingWizard } from "./OnboardingWizard";

/** 挂在 AppShell 里: 未完成引导 (或从设置页重新打开) 时把引导窗口盖在当前页面上。 */
export function OnboardingHost() {
  const { pathname } = useLocation();
  const onboarding = useOnboardingState();
  const { state } = useWizard();
  const visible = isWizardVisible({
    completed: onboarding.data?.completed,
    dismissed: state.dismissed,
    reopened: state.reopened,
    pathname,
  });
  return visible ? <OnboardingWizard /> : null;
}
