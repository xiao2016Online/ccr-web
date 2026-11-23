/**
 * 界面主题注册表。
 *
 * 服务器版提供两套配色: 科技蓝 (默认) 与暖橙, 画风同为 plain
 * (标准布局: 规整圆角 / 常规描边)。两套的 token 结构完全一致, 只换色值,
 * 因此切换主题不影响任何布局。
 *
 * 主题插件 (`plugin:<id>`) 只覆盖 token, 建在「科技蓝」之上:
 * <html data-theme="techblue ccr-<id>", 插件未声明的 token 自动回退到科技蓝。
 *
 * index.html 里有首帧前的内联脚本同步这两个属性, 增删主题时要一起改。
 */
export type BuiltinThemeId = "techblue" | "techorange";
/** 已安装的主题插件: `plugin:<插件 id>` */
export type PluginThemeId = `plugin:${string}`;
export type ThemeId = BuiltinThemeId | PluginThemeId;
export type ThemeArt = "plain" | "sketch" | "win2k";

export interface ThemeDef {
  id: ThemeId;
  art: ThemeArt;
  /** 主题名的 i18n key */
  labelKey: string;
  /** 继承哪个主题的外形规则 (只换配色); 写进 data-theme 的前面 */
  base?: BuiltinThemeId;
}

/** 顺序即侧栏主题按钮的轮换顺序、设置页里按钮的排列顺序 */
export const THEMES: readonly (ThemeDef & { id: BuiltinThemeId })[] = [
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

const PLUGIN_THEME_RE = /^plugin:[a-z0-9][a-z0-9-]{1,39}$/;

export function isPluginThemeId(v: unknown): v is PluginThemeId {
  return typeof v === "string" && PLUGIN_THEME_RE.test(v);
}

/** `plugin:<id>` → `<id>`; 内置主题返回 null */
export function pluginIdOf(id: ThemeId): string | null {
  return isPluginThemeId(id) ? id.slice("plugin:".length) : null;
}

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v) || isPluginThemeId(v);
}

export function themeDef(id: ThemeId): ThemeDef {
  if (isPluginThemeId(id)) return { id, art: "plain", labelKey: "theme.name.plugin", base: "techblue" };
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** 轮换到下一个主题 */
export function nextThemeId(id: ThemeId): ThemeId {
  // 侧栏按钮只在内置主题间轮换; 当前是插件主题时回到第一个
  const i = THEMES.findIndex((t) => t.id === id);
  return THEMES[(i + 1) % THEMES.length].id;
}

export function applyThemeAttrs(id: ThemeId) {
  const root = document.documentElement;
  const def = themeDef(id);
  const pid = pluginIdOf(id);
  const own = pid ? `ccr-${pid}` : id;
  root.dataset.theme = def.base ? `${def.base} ${own}` : own;
  root.dataset.art = ART_ATTR[def.art];
}
