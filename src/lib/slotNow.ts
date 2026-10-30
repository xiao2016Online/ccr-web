// 订阅某个四槽位「此刻」的生效模型, 供订阅列表 / 实时路由 / 虚拟模型页显示。
// 纯 TS (scripts/check-slot-schedule.mjs 直接 import): 只许 type-only import 与同样纯的模块。
import { effectiveModel, type WallClock } from "@/lib/slotSchedule";
import type { FourSlot, SubscriptionDto } from "@/types";

/** 订阅的 slot 槽在 at 时刻的生效模型 (null = 此刻不提供)。 */
export function slotModelAt(sub: SubscriptionDto, slot: FourSlot, at: WallClock): string | null {
  return effectiveModel(sub.model_slots[slot] ?? "", sub.slot_schedules?.[slot] ?? [], at);
}

export interface SlotNowView {
  /** 此刻生效模型; null = 此刻不提供 */
  model: string | null;
  /** 槽位设了时段规则 (显示「分时段」标记) */
  scheduled: boolean;
  /** 默认为空且没有规则: 这个槽位永远不会被调用 */
  neverCalled: boolean;
}

/**
 * 此刻的槽位显示信息。clock 来自 useHostClock (宿主机时间); 首次取到之前为 null,
 * 这时用后端随 DTO 下发的 slot_models_now, 免得先闪一下「此时段不可用」。
 */
export function slotNow(sub: SubscriptionDto, slot: FourSlot, clock: WallClock | null): SlotNowView {
  const rules = sub.slot_schedules?.[slot] ?? [];
  const scheduled = rules.length > 0;
  const model = clock ? slotModelAt(sub, slot, clock) : (sub.slot_models_now?.[slot] ?? null);
  return {
    model,
    scheduled,
    neverCalled: !scheduled && (sub.model_slots[slot] ?? "").trim() === "",
  };
}

/** 显示用文字: 生效模型 /「不会被调用」/「此时段不可用」。「分时段」标记由调用方按 scheduled 另画。 */
export function slotNowText(view: SlotNowView, t: (key: string) => string): string {
  if (view.neverCalled) return t("schedule.now.neverCalled");
  return view.model ?? t("schedule.now.unavailable");
}

