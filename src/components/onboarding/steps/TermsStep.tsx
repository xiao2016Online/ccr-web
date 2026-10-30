import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useDisclaimerAccepted, type Wizard } from "../wizardStore";
import { useStepFooter } from "../stepFooter";

const PARAGRAPHS = ["usage", "tos", "warranty", "affiliation"] as const;

/** 第 2 步: 免责声明原文 + 同意勾选; 不勾选不能下一步。 */
export function TermsStep(_: { wizard: Wizard }) {
  const { t } = useT();
  const [accepted, setAccepted] = useDisclaimerAccepted();
  useStepFooter({ canNext: accepted });

  return (
    <div className="ob-stack ob-fill">
      <h3 className="ob-h">{t("about.disclaimer.title")}</h3>
      <div className="ob-terms" tabIndex={0}>
        {PARAGRAPHS.map((k) => (
          <p key={k}>{t(`about.disclaimer.${k}`)}</p>
        ))}
      </div>
      <label className={cn("ob-agree", accepted && "on")}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        {t("onboarding.disclaimer.accept")}
      </label>
    </div>
  );
}
