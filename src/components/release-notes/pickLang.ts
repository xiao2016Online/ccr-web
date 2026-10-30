import type { NotesDoc, NotesLang, VersionNotes } from "@/types";

/** 标签顺序固定; 标签名用各自的母语, 不随界面语言翻译 (spec §5.3) */
export const NOTES_LANGS: readonly NotesLang[] = ["zh", "zh-Hant", "en", "ja"];

export const NOTES_LANG_LABEL: Record<NotesLang, string> = {
  zh: "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
};

/** 想看的语言缺了按什么顺序回退: 繁中先退简中 (同一种文字, 比英文好读), 其余先退英文。zh 必有, 排在最后兜底 */
export function notesFallback(want: NotesLang): readonly NotesLang[] {
  return want === "zh-Hant" ? ["zh-Hant", "zh", "en"] : [want, "en", "zh"];
}

/** 该版本实际写了哪些语言, 按固定顺序 */
export function availableLangs(v: VersionNotes): NotesLang[] {
  return NOTES_LANGS.filter((l) => v.notes[l] !== undefined);
}

/** 想看 want; 没有就按 notesFallback 回退。zh 必有, 所以总有结果 */
export function resolveLang(want: NotesLang, v: VersionNotes): NotesLang {
  for (const l of notesFallback(want)) {
    if (v.notes[l] !== undefined) return l;
  }
  return "zh";
}

export function docFor(v: VersionNotes, lang: NotesLang): NotesDoc {
  return v.notes[lang] ?? v.notes.zh;
}
