import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/tauri";
import { detectSystemLocale, useT, type LanguagePref, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";
import { SETTINGS_KEY, useSettings } from "@/hooks/useSettings";
import { useTheme, type ColorMode } from "@/hooks/useTheme";
import { THEMES, DEFAULT_THEME_ID, type ThemeId } from "@/themes";
import type { Settings } from "@/types";
import type { Wizard } from "../wizardStore";
import { useStepFooter } from "../stepFooter";

/** 语言名与示例句用该语言本身写, 不随界面语言翻译 (同设置页的语言下拉)。 */
export const NATIVE: Record<Locale, { name: string; sample: string; tag: string }> = {
  zh: { name: "简体中文", sample: "代理运行中 · 4 个订阅可用", tag: "zh-CN" },
  "zh-Hant": { name: "繁體中文", sample: "代理執行中 · 4 個訂閱可用", tag: "zh-TW" },
  en: { name: "English", sample: "Proxy running · 4 subscriptions ready", tag: "en" },
  ja: { name: "日本語", sample: "プロキシ稼働中 · 4 件利用可能", tag: "ja" },
};
const LOCALES: readonly Locale[] = ["zh", "zh-Hant", "en", "ja"];
const COLOR_MODES: readonly ColorMode[] = ["system", "light", "dark"];

/** 第 1 步: 语言 / 界面主题 / 明暗模式, 全部即选即生效。 */
export function AppearanceStep(_: { wizard: Wizard }) {
  const { t } = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const { mode, setMode, themeId, setThemeId } = useTheme();
  const pref: LanguagePref = settings.data?.preferred_language ?? "system";
  const system = detectSystemLocale();
  useStepFooter({ canNext: true });

  async function pickLang(next: LanguagePref) {
    if (next === pref) return;
    // 先乐观写进缓存, 窗口与背后主界面同一帧换语言; 失败时回滚到服务端的值
    const prevData = qc.getQueryData<Settings>(SETTINGS_KEY);
    if (prevData) qc.setQueryData<Settings>(SETTINGS_KEY, { ...prevData, preferred_language: next });
    try {
      const saved = await api.updateSettings({ preferred_language: next });
      qc.setQueryData(SETTINGS_KEY, saved);
    } catch {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    }
  }

  const langOpts: { id: LanguagePref; name: string; sub: string; nameTag?: string }[] = [
    { id: "system", name: t("onboarding.wizard.appearance.followSystem"), sub: t("onboarding.wizard.appearance.detected", { name: NATIVE[system].name }) },
    ...LOCALES.map((l) => ({ id: l, name: NATIVE[l].name, sub: NATIVE[l].sample, nameTag: NATIVE[l].tag })),
  ];

  return (
    <div className="ob-stack">
      <h3 className="ob-h" id="ob-lang-h">{t("onboarding.wizard.appearance.language")}</h3>
      <div className="ob-lang-grid" role="radiogroup" aria-labelledby="ob-lang-h">
        {langOpts.map((o) => {
          const sel = o.id === pref;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={sel}
              className={cn("ob-option", o.id === "system" && "wide", sel && "selected")}
              onClick={() => void pickLang(o.id)}
            >
              <span className="ob-radio" aria-hidden="true" />
              <span className="ob-option-text">
                <span className="ob-option-name" lang={o.nameTag}>{o.name}</span>
                <span className="ob-option-sub" lang={o.nameTag}>{o.sub}</span>
              </span>
              {o.id === "system" && <span className="ob-badge">{t("onboarding.wizard.default")}</span>}
            </button>
          );
        })}
      </div>

      <h3 className="ob-h" id="ob-theme-h">{t("settings.appearance.theme.label")}</h3>
      <div className="ob-theme-grid" role="radiogroup" aria-labelledby="ob-theme-h">
        {THEMES.map((th) => {
          const sel = th.id === themeId;
          return (
            <button
              key={th.id}
              type="button"
              role="radio"
              aria-checked={sel}
              className={cn("ob-option ob-theme", sel && "selected")}
              onClick={() => setThemeId(th.id as ThemeId)}
            >
              <span className={cn("ob-theme-pv", `pv-${th.id}`)} aria-hidden="true">
                <span className="pv-bar" />
                <span className="pv-card" />
                <span className="pv-btn" />
              </span>
              <span className="ob-theme-name">
                <span className="ob-radio" aria-hidden="true" />
                <span className="ob-option-name">{t(th.labelKey)}</span>
                {th.id === DEFAULT_THEME_ID && <span className="ob-badge plain">{t("onboarding.wizard.default")}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="ob-mode-row">
        <span className="ob-h" id="ob-mode-h">{t("settings.appearance.mode.label")}</span>
        <div className="ob-seg" role="radiogroup" aria-labelledby="ob-mode-h">
          {COLOR_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={cn("ob-seg-item", mode === m && "selected")}
              onClick={() => setMode(m)}
            >
              {t(`settings.theme.${m}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
