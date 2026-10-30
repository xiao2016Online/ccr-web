// 模型名 → 稳定的色块颜色 (同名永远同色)。bg 是日历格底色, bar 是同色系的深色条 / 图例点。
// 只引用主题变量, 深浅色随主题自动切换。

const FILLS = [
  "--fill-sky",
  "--fill-coral",
  "--fill-butter",
  "--fill-heather",
  "--fill-cactus",
  "--fill-nose",
] as const;

/** FNV-1a 32 位。 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type ModelColor = { bg: string; bar: string };

function colorOf(fill: string): ModelColor {
  return {
    bg: `var(${fill})`,
    // 同色系深色条, 亮 / 暗主题各有一套值 (styles.css 的 --fill-*-bar)。
    // 不能用 color-mix 混 --ink-2: 暗色下 ink 是浅色, 混出来全是灰。
    bar: `var(${fill}-bar)`,
  };
}

/**
 * 单个模型的兜底配色 (只有 6 色, 不同模型可能撞色)。
 * 同一视图里有多个模型时用 `assignModelColors`。
 */
export function modelColor(model: string): ModelColor {
  return colorOf(FILLS[fnv1a(model) % FILLS.length]);
}

/** assignModelColors 用的全部九个柔和色, 软色在前, 深陶土放最后。 */
const ASSIGN_FILLS = [
  "--fill-sky",
  "--fill-coral",
  "--fill-butter",
  "--fill-heather",
  "--fill-cactus",
  "--fill-nose",
  "--fill-oat",
  "--fill-stone",
  "--fill-clay-deep",
] as const;

/**
 * 给一个视图里出现的全部模型分配互不相同的颜色 (超过九个才循环)。
 * 去重后按名字排序 (纯码点比较, 与界面语言无关) 再依次取色, 所以同一组模型无论传入顺序如何,
 * 映射都相同。调用方 (日程、路由小图、色条、图例) 应对「该视图显示的所有模型」建一张表,
 * 同一视图内各图共用, 保证同一模型同色、不同模型不撞色。
 */
export function assignModelColors(models: Iterable<string>): Map<string, ModelColor> {
  const names = [...new Set(models)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = new Map<string, ModelColor>();
  names.forEach((m, i) => out.set(m, colorOf(ASSIGN_FILLS[i % ASSIGN_FILLS.length])));
  return out;
}
