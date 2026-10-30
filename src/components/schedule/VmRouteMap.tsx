import { Fragment, type CSSProperties } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router";
import { GripVertical, Plus, X } from "lucide-react";
import { stateTone } from "@/components/StatusBadge";
import { useRouteFlashState } from "@/hooks/useRouteFlash";
import { useT, type TFunction } from "@/i18n";
import { modelColor, type ModelColor } from "@/lib/modelColor";
import { dayPreset, type WallClock } from "@/lib/slotSchedule";
import { vmNameToSlot } from "@/lib/virtualModels";
import type { VirtualModelDto, VirtualModelName } from "@/types";
import type { RouteGroup, RouteMapData, RouteRow, RouteTag, SkipReason } from "./routeMap";

// 画布几何 (px), 与设计稿 VirtualModelsV2 一致。TS 与 styles.css 的 .vrm-* 成对:
// 盒子位置 / 尺寸在这里, 描边 / 字号 / 颜色在 CSS。
const W = 1000;
const TOP = 26;
const ROW_H = 54;
const GAP = 16;
const VM_W = 150;
const VM_H = 52;
const SUB_LEFT = 196;
const SUB_W = 196;
const SUB_H = 46;
const ROW_LEFT = 448;
const ROW_W = 236;
/** fallback / jev 没有星期与时间条列, 行可以占满到画布右边 */
const FIXED_ROW_W = 400;
const DAYS_LEFT = 700;
const BAR_LEFT = 856;
const BAR_W = 140;
const ADD_H = 36;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

const TAG_KEY: Record<Exclude<RouteTag, "skipped">, string> = {
  first: "schedule.map.tag.first",
  backup: "schedule.map.tag.backup",
  rr: "schedule.map.tag.rr",
  sticky: "schedule.map.tag.sticky",
  off: "schedule.map.tag.off",
};
const SKIP_TAG_KEY: Record<SkipReason, string> = {
  cooldown: "schedule.map.tag.cooldown",
  rate_limited: "schedule.map.tag.rateLimited",
  quota: "schedule.map.tag.quota",
};
const SKIP_NOTE_KEY: Record<SkipReason, string> = {
  cooldown: "schedule.map.skip.cooldown",
  rate_limited: "schedule.map.skip.rateLimited",
  quota: "schedule.map.skip.quota",
};

interface Props {
  vm: VirtualModelDto;
  /** 调用方用 buildRouteMap(vm, subsMap, at, isNow) 算好的图数据 (卡片头部摘要也用它, 只算一次) */
  data: RouteMapData;
  /** 所选时刻 (宿主机墙钟), 与 data 同一时刻: 画星期高亮与时间条竖线 */
  at: WallClock;
  /** 整页一张配色表 (assignModelColors), 同一模型在所有卡片里同色 */
  colors: Map<string, ModelColor>;
  onReorder(ids: string[]): void;
  onRemove(id: string): void;
  onAdd(): void;
}

/** 星期集合的显示名: 每天 / 工作日 / 周末, 其余逐个列出 (「周一、周三」)。 */
function daysText(days: number[], t: TFunction): string {
  const p = dayPreset(days);
  if (p !== "custom") return t(`schedule.edit.preset.${p}`);
  return days.map((d) => t("schedule.day.one", { d: t(`schedule.wd.${d}`) })).join(t("schedule.day.listSep"));
}

function rowLabel(row: RouteRow, t: TFunction): string {
  return t(row.label.key, row.days ? { days: daysText(row.days, t), ...row.label.params } : row.label.params);
}

function rowModelText(row: RouteRow, t: TFunction): string {
  if (row.model !== null) return row.model;
  // fixed 行没有模型 = 透传客户端 model (翻译类未配兜底槽的除外, 它会被跳过)
  return row.kind === "fixed" && row.usable
    ? t("schedule.map.passthrough")
    : t("schedule.map.notParticipating");
}

function tagText(tag: RouteTag, skipped: SkipReason | null, t: TFunction): string {
  return tag === "skipped" && skipped ? t(SKIP_TAG_KEY[skipped]) : t(TAG_KEY[tag === "skipped" ? "off" : tag]);
}

/** 连线样式: 组名次决定 虚拟模型 → 订阅; 订阅 → 行只有命中行跟随名次。 */
function groupTone(g: RouteGroup): string {
  return g.rank ?? "off";
}
function rowTone(g: RouteGroup, row: RouteRow): string {
  if (!row.active) return "idle";
  return g.rank ?? "miss";
}

/** 两点之间的横向 S 形贝塞尔。 */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

/**
 * 一个虚拟模型的路由图 (spec §6.3): 虚拟模型 → 订阅 (按绑定顺序, 可拖动排序) → 真实模型行,
 * 四槽虚拟模型另有星期七格与所选那天的 0–24 时间条。线条与标记随所选时刻变化。
 * 宽度固定, 外层横向滚动 (拓扑图挤压会让连线与行错位)。
 */
export function VmRouteMap({ vm, data, at, colors, onReorder, onRemove, onAdd }: Props) {
  const { t } = useT();
  const slot = vmNameToSlot(vm.name);
  const timed = slot !== null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // 拖动手柄是按钮: 聚焦后 Space 拾起、上下方向键移动、Space 放下
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 纵向排布: 每组高 = 行数 × ROW_H, 组间 GAP, 列底是「添加订阅」
  const layout: { top: number; h: number }[] = [];
  let y = TOP;
  for (const g of data.groups) {
    const h = g.rows.length * ROW_H;
    layout.push({ top: y, h });
    y += h + GAP;
  }
  const addTop = y;
  const total = addTop + ADD_H + 6;
  const vmCy = TOP + (total - TOP) / 2;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // 在完整的绑定列表上移动: 找不到订阅的 id (不画) 保留原位
    const ids = vm.subscription_ids;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  const colorOf = (model: string | null): string | null =>
    model === null ? null : (colors.get(model) ?? modelColor(model)).bar;
  const fillOf = (model: string | null): string | null =>
    model === null ? null : (colors.get(model) ?? modelColor(model)).bg;
  // 竖线指向所选时刻所在半小时格的中点, 不落在段的边界上
  const tickLeft = `calc(${((Math.floor(at.minute / 30) + 0.5) / 48) * 100}% - 1px)`;
  const dayCaption = t("schedule.map.colDay", { day: t("schedule.day.one", { d: t(`schedule.wd.${at.weekday}`) }) });

  return (
    <div className="vrm-wrap">
      <div className="vrm" style={{ width: W, height: total }} role="group" aria-label={t("schedule.map.aria", { vm: vm.name })}>
        <svg className="vrm-edges" width={W} height={total} viewBox={`0 0 ${W} ${total}`} aria-hidden>
          <g filter="url(#ccr-rough-canvas)">
            {/* 撑满画布的隐形框: 只剩水平连线时组的包围盒高度为 0, 滤镜会把线吞掉 */}
            <rect width={W} height={total} fill="none" stroke="none" />
            {data.groups.map((g, gi) => {
              const sc = layout[gi].top + layout[gi].h / 2;
              return (
                <Fragment key={g.sub.id}>
                  <path className={`vrm-edge ${groupTone(g)}`} d={curve(VM_W, vmCy, SUB_LEFT, sc)} />
                  {g.rows.map((row, ri) => {
                    const rc = layout[gi].top + ri * ROW_H + ROW_H / 2;
                    return (
                      <path key={ri} className={`vrm-edge ${rowTone(g, row)}`} d={curve(SUB_LEFT + SUB_W, sc, ROW_LEFT, rc)} />
                    );
                  })}
                </Fragment>
              );
            })}
          </g>
        </svg>

        <span className="vrm-col" style={{ left: SUB_LEFT }}>{t("schedule.map.colSubs")}</span>
        <span className="vrm-col" style={{ left: ROW_LEFT }}>{t("schedule.map.colModels")}</span>
        {timed && (
          <>
            <span className="vrm-col" style={{ left: DAYS_LEFT }}>{t("schedule.map.colDays")}</span>
            <span className="vrm-col" style={{ left: BAR_LEFT }}>{dayCaption}</span>
          </>
        )}

        <div className="vrm-vm mono" style={{ top: vmCy - VM_H / 2, width: VM_W, height: VM_H }} title={vm.name}>
          {vm.name}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={data.groups.map((g) => g.sub.id)} strategy={verticalListSortingStrategy}>
            {data.groups.map((g, gi) => (
              <SubNode
                key={g.sub.id}
                group={g}
                index={gi}
                center={layout[gi].top + layout[gi].h / 2}
                vmName={vm.name}
                href={`/subscriptions/${g.sub.id}${slot ? `?slot=${slot}` : ""}`}
                onRemove={() => onRemove(g.sub.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {data.groups.map((g, gi) =>
          g.rows.map((row, ri) => {
            const top = layout[gi].top + ri * ROW_H;
            const rc = top + ROW_H / 2;
            const bar = colorOf(row.model);
            const fill = fillOf(row.model);
            return (
              <Fragment key={`${g.sub.id}-${ri}`}>
                <div
                  className={row.active ? "vrm-row active" : "vrm-row"}
                  style={{ top: top + 4, left: ROW_LEFT, width: timed ? ROW_W : FIXED_ROW_W, height: ROW_H - 8, "--vrm-bar": bar ?? "var(--line-2)" } as CSSProperties}
                >
                  <div className="vrm-row-head">
                    <span className={row.model !== null ? "vrm-model mono" : "vrm-model none"} title={rowModelText(row, t)}>
                      {rowModelText(row, t)}
                    </span>
                    {row.tag && <span className={`vrm-tag ${row.tag}`}>{tagText(row.tag, g.skipped, t)}</span>}
                  </div>
                  <div className="vrm-row-label" title={rowLabel(row, t)}>{rowLabel(row, t)}</div>
                </div>
                {timed && (
                  <>
                    <div className={row.active ? "vrm-days" : "vrm-days dim"} style={{ top: rc - 9, left: DAYS_LEFT }} aria-hidden>
                      {WEEKDAYS.map((d) => {
                        // 收尾行 (days=null) 视其他规则而定: 七天都涂斜线底
                        const cls = row.days === null ? "hatch" : row.days.includes(d) ? "on" : "";
                        return (
                          <span
                            key={d}
                            className={`vrm-day ${cls}${d === at.weekday ? " cur" : ""}`}
                            style={{ "--vrm-fill": fill ?? "var(--line)" } as CSSProperties}
                          >
                            {t(`schedule.wd.${d}`)}
                          </span>
                        );
                      })}
                    </div>
                    <div className={row.active ? "vrm-bar" : "vrm-bar dim"} style={{ top: rc - 5, left: BAR_LEFT, width: BAR_W }} aria-hidden>
                      {row.segments.map((s) => (
                        <span
                          key={s.from}
                          style={{ left: `${(s.from / 48) * 100}%`, width: `${((s.to - s.from) / 48) * 100}%`, background: bar ?? "var(--line-2)" }}
                        />
                      ))}
                      <span className="vrm-tick" style={{ left: tickLeft }} />
                    </div>
                  </>
                )}
              </Fragment>
            );
          }),
        )}

        <button type="button" className="vrm-add" style={{ top: addTop, left: SUB_LEFT, width: SUB_W, height: ADD_H }} onClick={onAdd}>
          <Plus size={12} aria-hidden /> {t("virtualModels.addButtonShort")}
        </button>
      </div>
    </div>
  );
}

function SubNode({
  group,
  index,
  center,
  vmName,
  href,
  onRemove,
}: {
  group: RouteGroup;
  index: number;
  center: number;
  vmName: VirtualModelName;
  href: string;
  onRemove: () => void;
}) {
  const { t } = useT();
  const { sub, rank, skipped } = group;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sub.id });
  // 实时路由事件: 请求经过这个订阅时节点闪一下 (同一订阅在不同虚拟模型下各自闪)
  const flash = useRouteFlashState(vmName, sub.id);
  // 状态正常却不可调度 = 本地限额已满, 与 routeMap.transientStatus 同口径
  const tone = stateTone(sub.state);
  const dot =
    tone === "ok"
      ? sub.enabled && sub.is_dispatchable === false
        ? " warn"
        : ""
      : tone === "err"
        ? " err"
        : tone === "warn"
          ? " warn"
          : " idle";
  const cls = rank === "first" ? "first" : rank ? "on" : "off";
  const top = center - SUB_H / 2;
  return (
    <>
      <div
        ref={setNodeRef}
        className={`vrm-sub ${cls}${flash ? ` route-flash-${flash.kind}` : ""}`}
        style={{
          top,
          left: SUB_LEFT,
          width: SUB_W,
          height: SUB_H,
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.6 : undefined,
          zIndex: isDragging ? 2 : undefined,
        }}
      >
        <button
          className="vrm-grip"
          {...attributes}
          {...listeners}
          type="button"
          aria-label={t("schedule.map.dragAria", { name: sub.display_name })}
        >
          <GripVertical size={12} strokeWidth={1.6} />
        </button>
        <span className="vrm-idx">{index + 1}</span>
        <span className={`endpoint-status${dot}`} aria-hidden />
        <Link className="vrm-sub-name" to={href} title={sub.display_name}>
          {sub.display_name}
        </Link>
        <button
          className="vrm-remove"
          onClick={onRemove}
          type="button"
          aria-label={t("schedule.map.removeAria", { vm: vmName, name: sub.display_name })}
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      {skipped && (
        <span className="vrm-skip" style={{ top: center + SUB_H / 2 + 2, left: SUB_LEFT + 8 }}>
          {t(SKIP_NOTE_KEY[skipped])}
        </span>
      )}
    </>
  );
}
