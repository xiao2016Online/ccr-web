import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useSettings } from "@/hooks/useSettings";
import zh from "./locales/zh.json";
import zhHant from "./locales/zh-Hant.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import { localeFromTag, resolvePref, type Locale } from "./localeTag";

export type { Locale };
export type LanguagePref = "system" | Locale;

const dictionaries: Record<Locale, Record<string, string>> = {
  zh: zh as Record<string, string>,
  "zh-Hant": zhHant as Record<string, string>,
  en: en as Record<string, string>,
  ja: ja as Record<string, string>,
};

/**
 * 写到 `<html lang>` 的 BCP 47 标签. 界面语言与它不一致时, 汉字会按别的地区的字形渲染
 * (styles.css 的 :lang 规则按它换中日文字体), 浏览器还会提示「翻译此页」, 屏幕阅读器也会读错语言.
 */
const HTML_LANG: Record<Locale, string> = { zh: "zh-CN", "zh-Hant": "zh-TW", en: "en", ja: "ja" };

function systemTag(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.language || (navigator.languages && navigator.languages[0]) || "";
}

/** 系统语言 → 界面语言, 规则见 localeTag.ts (与托盘、TUI 共用 locale-cases.json)。 */
export function detectSystemLocale(): Locale {
  return localeFromTag(systemTag());
}

export type TParams = Record<string, string | number>;
export type TFunction = (key: string, params?: TParams) => string;

type I18nValue = {
  t: TFunction;
  locale: Locale;
};

const I18nContext = createContext<I18nValue>({
  t: (k) => k,
  locale: "en",
});

function applyParams(template: string, params: TParams): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const locale = resolvePref(settings?.preferred_language, systemTag());
  const dict = dictionaries[locale];

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);

  const t = useCallback<TFunction>(
    (key, params) => {
      // zh-Hant / en / ja 缺失的 key 先回退中文, 避免界面出现原始 key（zh-first 文案流程）.
      const tpl = dict[key] ?? dictionaries.zh[key] ?? key;
      return params ? applyParams(tpl, params) : tpl;
    },
    [dict],
  );

  const value = useMemo<I18nValue>(() => ({ t, locale }), [t, locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
