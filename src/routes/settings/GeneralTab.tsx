import { Toggle } from "@/components/Toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT, type LanguagePref } from "@/i18n";
import { runtime } from "@/runtime";
import { useTheme, type ColorMode } from "@/hooks/useTheme";
import type { UpdateSource } from "@/types";
import type { SettingsForm } from "./useSettingsForm";

const COLOR_MODES: readonly ColorMode[] = ["system", "light", "dark"];

/** 通用: 语言 / 开机自启 / 更新源, 外观 (界面主题 / 明暗模式). */
export function GeneralTab({ form }: { form: SettingsForm }) {
  const { t } = useT();
  const { mode, setMode } = useTheme();

  return (
    <>
      <div className="card section">
        <div className="card-head">
          <div className="card-title">{t("settings.section.language")}</div>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div className="label-col">
              {t("settings.language.label")}
              <div className="desc">{t("settings.language.desc")}</div>
            </div>
            <Select
              value={form.preferredLanguage}
              onValueChange={(v) => void form.changeLanguage(v as LanguagePref)}
            >
              <SelectTrigger style={{ maxWidth: 200 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.language.system")}</SelectItem>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ja">日本語</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {runtime.kind === "desktop" && (
            <>
              <div className="setting-row">
                <div className="label-col">{t("settings.proxy.autostart.label")}</div>
                <Toggle
                  checked={form.autostart}
                  onChange={(v) => void form.changeAutostart(v)}
                  aria-label={t("settings.proxy.autostart.label")}
                />
              </div>
              <div className="setting-row">
                <div className="label-col">{t("settings.update.source.label")}</div>
                <Select
                  value={form.settings.data?.update_source ?? "china"}
                  onValueChange={(v) => void form.changeUpdateSource(v as UpdateSource)}
                >
                  <SelectTrigger style={{ maxWidth: 240 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="international">
                      {t("settings.update.source.international")}
                    </SelectItem>
                    <SelectItem value="china">{t("settings.update.source.china")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 外观: 与侧栏底部的明暗按钮是同一份状态, 只存本机 (localStorage)。
          界面主题已固定为科技蓝一套, 这里只保留明暗模式。 */}
      <div className="card section">
        <div className="card-head">
          <div className="card-title">{t("settings.section.appearance")}</div>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div className="label-col">{t("settings.appearance.mode.label")}</div>
            <div
              className="radio-group"
              role="radiogroup"
              aria-label={t("settings.appearance.mode.label")}
              style={{ display: "flex", maxWidth: 300 }}
            >
              {COLOR_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? "on" : ""}
                  onClick={() => setMode(m)}
                  role="radio"
                  aria-checked={mode === m}
                  style={{ flex: 1 }}
                >
                  {t(`settings.theme.${m}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
