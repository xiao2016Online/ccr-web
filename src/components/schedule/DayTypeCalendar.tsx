import type { CSSProperties } from "react";
import { useT, type TFunction } from "@/i18n";
import { groupDayTypes, hhmm, runs } from "@/lib/slotSchedule";

/** 日程里的一个半小时格。key 相同的相邻格合并成一块; color 为 null 表示空档。 */
export type Cell = {
  key: string;
  title: string;
  /** 缺省时块内第二行写起止时刻 */
  subtitle?: string;
  color: { bg: string; bar: string } | null;
};

const SLOTS = 48;
/** 日程列高 (px)。块内能放几行字按它换算, CSS 经 --sched-body-h 取同一个值。 */
const BODY_H = 282;
const PX_PER_SLOT = BODY_H / SLOTS;
/** 块高超过它才写两行, 超过 MIN_ONE_LINE 才写一行 (再矮只留颜色, 文字进悬停提示) */
const MIN_TWO_LINES = 30;
const MIN_ONE_LINE = 15;
const AXIS_HOURS = [0, 6, 12, 18, 24];

/** 日型列名: 7 天 →「每天」, 1 天 →「周一」, 连续 →「周二至五」, 否则「周一、周三」。days 升序。 */
export function dayGroupLabel(days: number[], t: TFunction): string {
  const wd = (d: number) => t(`schedule.wd.${d}`);
  if (days.length === 7) return t("schedule.day.every");
  if (days.length === 1) return t("schedule.day.one", { d: wd(days[0]) });
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (contiguous) {
    return t("schedule.day.range", { from: wd(days[0]), to: wd(days[days.length - 1]) });
  }
  return days.map((d) => t("schedule.day.one", { d: wd(d) })).join(t("schedule.day.listSep"));
}

/**
 * 按日型合并的一周日程: 48 格完全相同的日子并成一列, 列内连续同 key 的格并成一块。
 * 空档按 emptyLabel 画: `unavailable` = 斜线底 (不画块), `no_candidate` = 红色虚线块「无可用」。
 */
export function DayTypeCalendar({
  cells,
  emptyLabel,
}: {
  cells: Cell[];
  emptyLabel: "unavailable" | "no_candidate";
}) {
  const { t } = useT();
  const groups = groupDayTypes(cells, (c) => c.key);

  return (
    <div
      className="sched-cal"
      style={{ "--sched-body-h": `${BODY_H}px`, "--sched-cols": groups.length } as CSSProperties}
    >
      <div className="sched-cal-axis" aria-hidden>
        {AXIS_HOURS.map((h) => (
          <span key={h} style={{ top: `${(h / 24) * 100}%` }}>
            {h}
          </span>
        ))}
      </div>
      {groups.map((g) => (
        <DayColumn
          key={g.days.join(",")}
          days={g.days}
          cells={g.cells}
          emptyLabel={emptyLabel}
          t={t}
        />
      ))}
    </div>
  );
}

function DayColumn({
  days,
  cells,
  emptyLabel,
  t,
}: {
  days: number[];
  cells: Cell[];
  emptyLabel: "unavailable" | "no_candidate";
  t: TFunction;
}) {
  const name = dayGroupLabel(days, t);
  return (
    <div className="sched-cal-col">
      <div className="sched-cal-head" title={name}>
        {name}
      </div>
      <div className={emptyLabel === "unavailable" ? "sched-cal-body hatched" : "sched-cal-body"}>
        {runs(cells, (c) => c.key).map((run) => (
          <Block key={run.start} start={run.start} end={run.end} cell={run.value} emptyLabel={emptyLabel} t={t} />
        ))}
      </div>
    </div>
  );
}

function Block({
  start,
  end,
  cell,
  emptyLabel,
  t,
}: {
  start: number;
  end: number;
  cell: Cell;
  emptyLabel: "unavailable" | "no_candidate";
  t: TFunction;
}) {
  const empty = cell.color === null;
  if (empty && emptyLabel === "unavailable") return null;

  const range = `${hhmm(start * 30)}–${hhmm(end * 30)}`;
  const title = empty ? t("schedule.noCandidate") : cell.title;
  const subtitle = empty ? t("schedule.will503") : (cell.subtitle ?? range);
  const px = (end - start) * PX_PER_SLOT;
  const style = {
    top: `calc(${(start / SLOTS) * 100}% + 1px)`,
    height: `calc(${((end - start) / SLOTS) * 100}% - 2px)`,
    ...(cell.color ? { "--sched-bg": cell.color.bg, "--sched-bar": cell.color.bar } : {}),
  } as CSSProperties;

  return (
    <div
      className={empty ? "sched-block empty" : "sched-block"}
      style={style}
      title={[title, subtitle === range ? null : subtitle, range].filter(Boolean).join(" · ")}
    >
      {px > MIN_ONE_LINE && <div className="sched-block-title">{title}</div>}
      {px > MIN_TWO_LINES && <div className="sched-block-sub">{subtitle}</div>}
    </div>
  );
}
