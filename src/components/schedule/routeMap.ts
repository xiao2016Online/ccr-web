// 虚拟模型页路由图 (第二版, spec §6.3) 的纯计算: 虚拟模型 → 订阅 (按绑定顺序) → 真实模型行。
// 纯 TS (scripts/check-slot-schedule.mjs 直接 import): 只许 type-only import 与同样纯的模块。
//
// 行 = 该订阅本槽位的每条规则一行 + 一行收尾; 某一时刻命中哪一行由 `winningRule` 决定
// (与 effectiveModel 同一份求值, 不另写)。
// 图的口径: 停用与凭证失效的订阅全周不可用; 冷却 / 限流 / 限额已满这类会自己恢复的瞬时状态
// 只在所选时刻 = 现在 (isNow) 时生效, 一周缺口也不看它们。
import { isAnthropicPassthrough } from "@/lib/authTypes";
import { assignModelColors, type ModelColor } from "@/lib/modelColor";
import { HALF_HOURS, clockAt, crossesMidnight, winningRule, type WallClock } from "@/lib/slotSchedule";
import { jevModelOf, vmNameToSlot } from "@/lib/virtualModels";
import type { FourSlot, SubscriptionDto, VirtualModelDto } from "@/types";

export type RouteRowKind = "rule" | "rest" | "all" | "restOff" | "empty" | "fixed";
export type RouteTag = "first" | "backup" | "rr" | "sticky" | "off" | "skipped";
export type SkipReason = "cooldown" | "rate_limited" | "quota";

export interface RouteRow {
  kind: RouteRowKind;
  /** 这一行的模型; null = 不参与 (四槽) 或透传客户端 model (fixed) */
  model: string | null;
  /** 时段说明。规则行的 `{days}` 由组件按 days 补 (星期名要翻译) */
  label: { key: string; params?: Record<string, string> };
  /** 规则生效的星期 (ISO 1..7, 升序); null = 收尾行 / fixed 行, 视其他规则而定或不分星期 */
  days: number[] | null;
  /** 命中这一行时会不会真的发请求 (四槽: 有模型; fixed: 没被 dispatch 跳过, 透传也算) */
  usable: boolean;
  /** 所选时刻命中的就是这一行 (每组恰好一行) */
  active: boolean;
  /** 只有命中行有标记 */
  tag: RouteTag | null;
  /** 所选那天这一行生效的半小时下标区间, to 不含 */
  segments: { from: number; to: number }[];
}

export interface RouteGroup {
  sub: SubscriptionDto;
  /** 所选时刻的名次: 顺序模式首选 / 备选, 轮询与会话亲和为 join; 此刻不用为 null */
  rank: "first" | "backup" | "join" | null;
  /** 只在 isNow 时给出: 本可参与, 因瞬时状态此刻被跳过 */
  skipped: SkipReason | null;
  rows: RouteRow[];
}

export interface RouteMapData {
  groups: RouteGroup[];
  summary: { kind: "first" | "rr" | "sticky" | "none"; sub?: string; model?: string; n?: number };
  /** 一周里没有任何可用订阅的小时数 (只看时段与稳定状态); fallback / jev 恒为 0 */
  gapHours: number;
  /** 第一段缺口, 截到当天结束。weekday 为 ISO 1..7, from / to 为当天半小时下标 (to 不含) */
  firstGap: { weekday: number; from: number; to: number } | null;
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const CELLS_PER_DAY = 48;

/** 停用与凭证失效需要用户介入, 视为全周不可用。 */
export function stablyAvailable(sub: SubscriptionDto): boolean {
  return sub.enabled !== false && sub.state !== "auth_failed";
}

/** 会自己恢复的瞬时状态; 正常为 null。 */
export function transientStatus(sub: SubscriptionDto): SkipReason | null {
  if (sub.state === "rate_limited") return "rate_limited";
  if (sub.state === "transient_error" || sub.state === "quota_exhausted") return "cooldown";
  // 状态正常却不可调度 = 本地 token 限额已满 (到下一周期自动恢复)
  if (sub.is_dispatchable === false) return "quota";
  return null;
}

const trimmed = (s: string | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

type RowBase = Pick<RouteRow, "kind" | "model" | "label" | "days">;

interface GroupSpec {
  sub: SubscriptionDto;
  rows: RowBase[];
  /** 命中这一行时会不会真的发请求 (四槽: 有模型; fixed: 没被 dispatch 跳过) */
  usable: boolean[];
  /** at 时刻命中的行下标 */
  activeAt: (at: WallClock) => number;
}

function slotSpec(sub: SubscriptionDto, slot: FourSlot): GroupSpec {
  const rules = sub.slot_schedules?.[slot] ?? [];
  const def = trimmed(sub.model_slots[slot]);
  const rows: RowBase[] = rules.map((r) => ({
    kind: "rule",
    model: trimmed(r.model),
    label: {
      key: crossesMidnight(r.start, r.end) ? "schedule.map.ruleNextDay" : "schedule.map.rule",
      params: { start: r.start, end: r.end },
    },
    days: [...r.days].sort((a, b) => a - b),
  }));
  if (rules.length > 0) {
    rows.push(
      def
        ? { kind: "rest", model: def, label: { key: "schedule.map.rest" }, days: null }
        : { kind: "restOff", model: null, label: { key: "schedule.map.restOff" }, days: null },
    );
  } else {
    rows.push(
      def
        ? { kind: "all", model: def, label: { key: "schedule.map.allDay" }, days: ALL_DAYS }
        : { kind: "empty", model: null, label: { key: "schedule.map.empty" }, days: ALL_DAYS },
    );
  }
  return {
    sub,
    rows,
    usable: rows.map((r) => r.model !== null),
    // 没有规则胜出 = 收尾行 (无规则时它就是唯一一行)
    activeAt: (at) => winningRule(rules, at) ?? rules.length,
  };
}

/** fallback / jev: 不受时段影响, 每个订阅一行。 */
function fixedSpec(sub: SubscriptionDto, jev: boolean): GroupSpec {
  let row: RowBase;
  let usable = true;
  if (jev) {
    const model = jevModelOf(sub);
    const key = trimmed(sub.model_slots.jev)
      ? "schedule.map.jevSlot"
      : model
        ? "schedule.map.jevExample"
        : "schedule.map.jevPassthrough";
    row = { kind: "fixed", model, label: { key }, days: null };
  } else {
    // 未配兜底槽: 透传类原样转发, 翻译类会被 dispatch 跳过 (pipeline.rs 统一守卫)
    const model = trimmed(sub.model_slots.fallback);
    usable = model !== null || isAnthropicPassthrough(sub.auth_type);
    const key = model
      ? "schedule.map.fallbackSlot"
      : usable
        ? "schedule.map.fallbackPassthrough"
        : "schedule.map.fallbackSkipped";
    row = { kind: "fixed", model, label: { key }, days: null };
  }
  return { sub, rows: [row], usable: [usable], activeAt: () => 0 };
}

/** 一天 48 格里命中 index 行的区间。 */
function segmentsOf(cells: number[], index: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let from = -1;
  for (let k = 0; k <= cells.length; k++) {
    const hit = k < cells.length && cells[k] === index;
    if (hit && from < 0) from = k;
    if (!hit && from >= 0) {
      out.push({ from, to: k });
      from = -1;
    }
  }
  return out;
}

export function buildRouteMap(
  vm: VirtualModelDto,
  subsMap: Map<string, SubscriptionDto>,
  at: WallClock,
  isNow: boolean,
): RouteMapData {
  const slot = vmNameToSlot(vm.name);
  const specs: GroupSpec[] = [];
  for (const id of vm.subscription_ids) {
    const sub = subsMap.get(id);
    if (!sub) continue;
    specs.push(slot !== null ? slotSpec(sub, slot) : fixedSpec(sub, vm.name === "model-jev"));
  }

  let candidates = 0;
  let first: RouteGroup | null = null;
  const groups = specs.map((s): RouteGroup => {
    const ai = s.activeAt(at);
    const stable = stablyAvailable(s.sub);
    const skipped = isNow && stable ? transientStatus(s.sub) : null;
    const ok = stable && s.usable[ai] && skipped === null;
    const rank: RouteGroup["rank"] = !ok
      ? null
      : vm.mode !== "sequential"
        ? "join"
        : candidates === 0
          ? "first"
          : "backup";
    if (ok) candidates++;
    const tag: RouteTag = !s.usable[ai]
      ? "off"
      : skipped !== null
        ? "skipped"
        : rank === "join"
          ? vm.mode === "round_robin"
            ? "rr"
            : "sticky"
          : (rank ?? "off");
    const day: number[] = [];
    for (let k = 0; k < CELLS_PER_DAY; k++) day.push(s.activeAt({ weekday: at.weekday, minute: k * 30 }));
    const group: RouteGroup = {
      sub: s.sub,
      rank,
      skipped,
      rows: s.rows.map((r, i) => ({
        ...r,
        usable: s.usable[i],
        active: i === ai,
        tag: i === ai ? tag : null,
        segments: segmentsOf(day, i),
      })),
    };
    if (rank === "first") first = group;
    return group;
  });

  let summary: RouteMapData["summary"];
  if (candidates === 0) summary = { kind: "none" };
  else if (vm.mode === "sequential" && first) {
    const g: RouteGroup = first;
    const model = g.rows.find((r) => r.active)?.model ?? null;
    summary = model !== null ? { kind: "first", sub: g.sub.display_name, model } : { kind: "first", sub: g.sub.display_name };
  } else summary = { kind: vm.mode === "round_robin" ? "rr" : "sticky", n: candidates };

  // 一周缺口: 只看时段规则与稳定状态 (fallback / jev 不分时段, 没有这个概念)
  let gapHours = 0;
  let firstGap: RouteMapData["firstGap"] = null;
  if (slot !== null) {
    const empty: boolean[] = [];
    for (let i = 0; i < HALF_HOURS; i++) {
      const t = clockAt(i);
      empty.push(!specs.some((s) => stablyAvailable(s.sub) && s.usable[s.activeAt(t)]));
    }
    gapHours = empty.filter(Boolean).length / 2;
    const i0 = empty.indexOf(true);
    if (i0 >= 0) {
      const dayStart = i0 - (i0 % CELLS_PER_DAY);
      let e = i0;
      while (e < dayStart + CELLS_PER_DAY && empty[e]) e++;
      firstGap = { weekday: clockAt(i0).weekday, from: i0 - dayStart, to: e - dayStart };
    }
  }

  return { groups, summary, gapHours, firstGap };
}

/**
 * 整页一张配色表 (同一模型在所有卡片里同色、不同模型不撞色): 全部虚拟模型 (含 fallback 兜底槽与
 * jev 模型) 路由图各行的模型。行的集合与时刻无关, 所以随便取一个时刻建图即可。
 */
export function pageModelColors(
  vms: VirtualModelDto[],
  subsMap: Map<string, SubscriptionDto>,
): Map<string, ModelColor> {
  const anyAt: WallClock = { weekday: 1, minute: 0 };
  const models: string[] = [];
  for (const vm of vms) {
    for (const g of buildRouteMap(vm, subsMap, anyAt, false).groups) {
      for (const r of g.rows) if (r.model !== null) models.push(r.model);
    }
  }
  return assignModelColors(models);
}
