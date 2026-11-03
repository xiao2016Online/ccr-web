/**
 * 界面主题注册表。
 *
 * 服务器版提供两套配色: 科技蓝 (默认) 与暖橙, 画风同为 plain
 * (标准布局: 规整圆角 / 常规描边)。两套的 token 结构完全一致, 只换色值,
 * 因此切换主题不影响任何布局。
 *
 * index.html 里有首帧前的内联脚本同步这两个属性, 增删主题时要一起改。
 */
export type ThemeId = "techblue" | "techorange";
export type ThemeArt = "plain" | "sketch" | "win2k";

export interface ThemeDef {
  id: ThemeId;
  art: ThemeArt;
  /** 主题名的 i18n key */
  labelKey: string;
}

/** 顺序即设置页 / 引导窗口里的排列顺序 */
export const THEMES: readonly ThemeDef[] = [
  { id: "techblue", art: "plain", labelKey: "theme.name.techblue" },
  { id: "techorange", art: "plain", labelKey: "theme.name.techorange" },
];

/** 画风 → data-art 的值 (含继承链) */
const ART_ATTR: Record<ThemeArt, string> = {
  plain: "plain",
  sketch: "sketch",
  win2k: "plain win2k",
};

/** 是否建在「素净」结构上 (经典 / Win2000): 这类画风共用改版前的实时路由页、像素 Logo 等组件 */
export function isPlainBased(art: ThemeArt): boolean {
  return art !== "sketch";
}

export const DEFAULT_THEME_ID: ThemeId = "techblue";

/** localStorage key; 与 index.html 内联脚本保持一致 */
export const THEME_ID_KEY = "cc-router-ui-theme";

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function themeDef(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** 轮换到下一个主题 */
export function nextThemeId(id: ThemeId): ThemeId {
  const i = THEMES.findIndex((t) => t.id === id);
  return THEMES[(i + 1) % THEMES.length].id;
}

export function applyThemeAttrs(id: ThemeId) {
  const root = document.documentElement;
  root.dataset.theme = id;
  root.dataset.art = ART_ATTR[themeDef(id).art];
}
