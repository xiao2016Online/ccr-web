// 槽位分时段规则的求值镜像。语义与 Rust `subscription/schedule.rs` 完全一致,
// 两边读同一张用例表 `slot-schedule-cases.json`。
// 纯 TS: 只许导入同样能被 Node 直接加载的纯 TS 模块 (scripts/check-slot-schedule.mjs 让 Node
// 直接 import 本文件; 被导入的模块自身也只能有 type-only import),
// 且不得用 Date 构造器推算星期 / 时刻 —— 「此刻」一律来自宿主机时钟 (useHostClock)。
import type { FourSlot, ScheduleRule, SlotSchedules } from "@/types";
import { SLOT_EFFORT_LEVELS } from "@/lib/modelSlots";

/** 本地墙钟读数。weekday 1(周一)..7(周日), minute 为当天 0 点起的分钟数 0..1439。 */
export interface WallClock {
  weekday: number;
  minute: number;
}

/**
 * 虚拟模型页「现在」的判定: 没有固定选择 (跟随宿主机) 或所选星期与半小时格恰好等于宿主机此刻。
 * 点了已高亮的星期、拖到当前格, 都仍算「现在」(此时才会叠加冷却 / 限流 / 限额的瞬时状态)。
 */
export function isNowSelection(selected: WallClock | null, host: WallClock | null): boolean {
  if (selected === null) return true;
  if (host === null) return false;
  return selected.weekday === host.weekday && Math.floor(selected.minute / 30) === Math.floor(host.minute / 30);
}

const MINUTES_PER_DAY = 1440;
export const MAX_RULES_PER_SLOT = 16;
/** 一周的半小时格数 (7 × 48)。 */
export const HALF_HOURS = 336;
const CELLS_PER_DAY = 48;

/** 严格 `HH:MM` (各两位数字) → 当天分钟数。`24:00` 合法 (=1440), 其余超过 23:59 不合法。 */
function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

const prevWeekday = (d: number) => (d <= 1 ? 7 : d - 1);

/** 规则是否覆盖 `at`。格式不合法的规则永不命中 (与 Rust 同)。 */
function ruleMatches(rule: ScheduleRule, at: WallClock): boolean {
  const s = parseHHMM(rule.start);
  const e = parseHHMM(rule.end);
  if (s === null || e === null) return false;
  if (s >= MINUTES_PER_DAY || s === e) return false;
  const today = rule.days.includes(at.weekday);
  if (s < e) return today && s <= at.minute && at.minute < e;
  return (
    (today && at.minute >= s) ||
    (rule.days.includes(prevWeekday(at.weekday)) && at.minute < e)
  );
}

const pick = (m: string): string | null => {
  const t = m.trim();
  return t === "" ? null : t;
};

/**
 * at 时刻胜出的规则下标: 按列表顺序第一个命中且模型非空白的; 没有为 null (此时用默认值)。
 * 命中但模型空白的规则被跳过, 继续往后找。
 */
export function winningRule(rules: ScheduleRule[], at: WallClock): number | null {
  for (let i = 0; i < rules.length; i++) {
    if (ruleMatches(rules[i], at) && pick(rules[i].model) !== null) return i;
  }
  return null;
}

/**
 * 此刻应使用的模型: 胜出规则 (`winningRule`) 的模型, 否则槽位默认值。结果已 trim, 空白为 null。
 */
export function effectiveModel(
  def: string,
  rules: ScheduleRule[],
  at: WallClock,
): string | null {
  const i = winningRule(rules, at);
  return i !== null ? pick(rules[i].model) : pick(def);
}

/** 当天分钟数 → `HH:MM` (1440 → `24:00`)。 */
export function hhmm(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 半小时下标 (0 = 周一 00:00) → 墙钟。 */
export function clockAt(index: number): WallClock {
  return {
    weekday: Math.floor(index / CELLS_PER_DAY) + 1,
    minute: (index % CELLS_PER_DAY) * 30,
  };
}

/** 对一周 336 个半小时格逐格求值。 */
export function weekCells<T>(fn: (at: WallClock) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < HALF_HOURS; i++) out.push(fn(clockAt(i)));
  return out;
}

/**
 * 按星期切成 7 个 48 格, 格序列 (经 key 映射) 相同的日子合并为一组, 保留首次出现顺序。
 * 每组的 cells 取该组第一天的 48 格。
 */
export function groupDayTypes<T>(
  cells: T[],
  key: (v: T) => string,
): { days: number[]; cells: T[] }[] {
  const groups: { days: number[]; cells: T[] }[] = [];
  const byKey = new Map<string, number>();
  for (let d = 0; d < 7; d++) {
    const dayCells = cells.slice(d * CELLS_PER_DAY, (d + 1) * CELLS_PER_DAY);
    const sig = JSON.stringify(dayCells.map(key));
    const at = byKey.get(sig);
    if (at === undefined) {
      byKey.set(sig, groups.length);
      groups.push({ days: [d + 1], cells: dayCells });
    } else {
      groups[at].days.push(d + 1);
    }
  }
  return groups;
}

/** 把格序列压成连续同 key 的段。start / end 是半小时下标, end 不含。 */
export function runs<T>(
  cells: T[],
  key: (v: T) => string,
): { start: number; end: number; value: T }[] {
  const out: { start: number; end: number; value: T }[] = [];
  let i = 0;
  while (i < cells.length) {
    const k = key(cells[i]);
    let j = i + 1;
    while (j < cells.length && key(cells[j]) === k) j++;
    out.push({ start: i, end: j, value: cells[i] });
    i = j;
  }
  return out;
}

/** 一周内有模型可用 (求值结果非 null) 的小时数。 */
export function weeklyHours(def: string, rules: ScheduleRule[]): number {
  const n = weekCells((at) => effectiveModel(def, rules, at)).filter(
    (m) => m !== null,
  ).length;
  return n / 2;
}

/**
 * 只提示不拦截的问题: 起止相同 (保存会被拒, 提前提示); 被前面的规则完全盖住
 * (只看它和排在它前面的规则: 加上它一周 336 格的求值结果不变)。
 * 被后面的同模型规则覆盖不算 —— 那时它是先命中的一条, 照样生效。
 */
export function ruleIssues(
  rules: ScheduleRule[],
): { index: number; kind: "same_start_end" | "shadowed" }[] {
  const out: { index: number; kind: "same_start_end" | "shadowed" }[] = [];
  // 默认值取空: 被盖住与否只看规则之间, 与默认值无关
  let before = weekCells((at) => effectiveModel("", [], at));
  rules.forEach((r, index) => {
    const upto = weekCells((at) => effectiveModel("", rules.slice(0, index + 1), at));
    if (r.start === r.end) {
      out.push({ index, kind: "same_start_end" });
    } else if (upto.every((m, i) => m === before[i])) {
      out.push({ index, kind: "shadowed" });
    }
    before = upto;
  });
  return out;
}

const halfHour = (s: string): number | null => {
  const m = parseHHMM(s);
  return m !== null && m % 30 === 0 ? m : null;
};

/** 与 Rust `validate_slot_schedules` 同规则, 返回 i18n key; 通过返回 null。 */
export function validateRules(rules: ScheduleRule[]): string | null {
  if (rules.length > MAX_RULES_PER_SLOT) return "schedule.err.too_many";
  for (const r of rules) {
    if (r.days.length === 0) return "schedule.err.days_empty";
    const seen = new Set<number>();
    for (const d of r.days) {
      if (!Number.isInteger(d) || d < 1 || d > 7) return "schedule.err.days_range";
      if (seen.has(d)) return "schedule.err.days_dup";
      seen.add(d);
    }
    const start = halfHour(r.start);
    if (start === null) return "schedule.err.start_format";
    if (start >= MINUTES_PER_DAY) return "schedule.err.start_24";
    const end = halfHour(r.end);
    if (end === null) return "schedule.err.end_format";
    if (start === end) return "schedule.err.same";
    if (r.model.trim() === "") return "schedule.err.model_empty";
    if (r.effort !== undefined && !SLOT_EFFORT_LEVELS.includes(r.effort)) return "schedule.err.effort";
  }
  return null;
}

/** 编辑页「星期」下拉的三个快捷项 (升序)。 */
export const DAY_PRESETS = {
  every: [1, 2, 3, 4, 5, 6, 7],
  workdays: [1, 2, 3, 4, 5],
  weekend: [6, 7],
} as const;

export type DayPreset = keyof typeof DAY_PRESETS | "custom";

/** 星期集合对应的快捷项 (与顺序无关); 对不上任何一项 (含重复 / 空) 为 custom。 */
export function dayPreset(days: number[]): DayPreset {
  const sorted = [...days].sort((a, b) => a - b).join(",");
  for (const k of Object.keys(DAY_PRESETS) as (keyof typeof DAY_PRESETS)[]) {
    if (DAY_PRESETS[k].join(",") === sorted) return k;
  }
  return "custom";
}

/** 结束早于开始 = 跨零点 (结束算次日)。`24:00` 结束不算; 格式不合法为 false。 */
export function crossesMidnight(start: string, end: string): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  return s !== null && e !== null && e < s;
}

const FOUR_SLOTS: FourSlot[] = ["fable", "opus", "sonnet", "haiku"];

/** 与后端序列化同形: 固定槽位顺序, 省略空列表。 */
export function normalizeSchedules(s: SlotSchedules): SlotSchedules {
  const out: SlotSchedules = {};
  for (const k of FOUR_SLOTS) {
    const rules = s[k];
    if (rules && rules.length > 0) out[k] = rules;
  }
  return out;
}

/** 草稿与已存配置是否相同 (空列表与缺省等价, 与键顺序无关)。 */
export function schedulesEqual(a: SlotSchedules, b: SlotSchedules): boolean {
  return JSON.stringify(normalizeSchedules(a)) === JSON.stringify(normalizeSchedules(b));
}

/**
 * 模型下拉里是否要把当前值标成「(列表外)」: 只在真有模型列表时才有意义 —— 没有列表
 * (手动模式 / 厂商没有 /models / 拉取失败) 时每个名字都会被误标, 同 ModelSlotPicker。
 */
export function outsideModelList(current: string, models: string[]): boolean {
  return current !== "" && models.length > 0 && !models.includes(current);
}
