/**
 * 系统语言标签 → 界面语言。
 *
 * 零 import 的纯函数: scripts/check-i18n.mjs 直接用 node 跑它。托盘 (src-tauri/src/tray/strings.rs)
 * 与 TUI (src-tauri/crates/cc-router-tui/src/i18n.rs) 各有一份 Rust 实现, 三处由同目录的
 * locale-cases.json 锁成同一条规则 —— 改规则先改用例表, 再改三处实现。
 */
export type Locale = "zh" | "zh-Hant" | "en" | "ja";

export const LOCALES: readonly Locale[] = ["zh", "zh-Hant", "en", "ja"];

/**
 * 规范化 (小写、`_`→`-`、截掉 `.编码` / `@修饰`) 后按子标签判定。书写系统优先于地区:
 * `zh-Hans-HK` 是简中, `zh-Hant-CN` 是繁中; 只有地区时 tw / hk / mo 归繁中。
 * 粤语 (`yue`, macOS 的「粵語（繁體）」) 同样判定, 什么都不带时默认繁中。
 */
export function localeFromTag(tag: string): Locale {
  const norm = tag.trim().toLowerCase().replace(/_/g, "-").split(/[.@]/)[0];
  const parts = norm.split("-").filter(Boolean);
  if (parts[0] === "zh" || parts[0] === "yue") {
    if (parts.includes("hant")) return "zh-Hant";
    if (parts.includes("hans")) return "zh";
    if (parts.some((p) => p === "tw" || p === "hk" || p === "mo")) return "zh-Hant";
    return parts[0] === "yue" ? "zh-Hant" : "zh";
  }
  if (parts[0] === "ja") return "ja";
  return "en";
}

/** `settings.preferred_language` → 界面语言。显式值命中即返回; "system" / 空 / 未知值跟随系统 (与托盘、TUI 一致)。 */
export function resolvePref(pref: string | undefined, systemTag: string): Locale {
  if (pref && (LOCALES as readonly string[]).includes(pref)) return pref as Locale;
  return localeFromTag(systemTag);
}
