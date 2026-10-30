import { useId } from "react";
import { Clock } from "lucide-react";
import { useT } from "@/i18n";
import { hhmm, type WallClock } from "@/lib/slotSchedule";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * 虚拟模型页顶部的「查看时刻」条 (spec §6.3, 吸顶): 统一驱动所有卡片的路由图。
 * 「现在」= 跟随宿主机时钟; 选星期或拖滑块 (半小时一档) 后固定在所选时刻, 点「现在」回到跟随。
 * at 为 null = 宿主机时钟还没取到, 控件全部禁用。
 */
export function ViewTimeBar({
  at,
  isNow,
  onPick,
  onNow,
}: {
  at: WallClock | null;
  isNow: boolean;
  onPick(at: WallClock): void;
  onNow(): void;
}) {
  const { t } = useT();
  const sliderId = useId();
  const cell = at ? Math.floor(at.minute / 30) : 0;
  // 跟随现在时读数是宿主机的真实分钟, 固定时是所选半小时格的起点
  const readout = at
    ? `${t("schedule.day.one", { d: t(`schedule.wd.${at.weekday}`) })} ${hhmm(isNow ? at.minute : cell * 30)}`
    : "—";

  return (
    <section className="vm-time" aria-label={t("schedule.view.title")}>
      <span className="vm-time-title">{t("schedule.view.title")}</span>
      <button type="button" className="vm-time-now" aria-pressed={isNow} disabled={!at} onClick={onNow}>
        <Clock size={14} aria-hidden /> {t("schedule.view.now")}
      </button>
      <div className="vm-time-days" role="group" aria-label={t("schedule.view.weekday")}>
        {WEEKDAYS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={at?.weekday === d}
            disabled={!at}
            onClick={() => onPick({ weekday: d, minute: cell * 30 })}
          >
            {t(`schedule.wd.${d}`)}
          </button>
        ))}
      </div>
      <label htmlFor={sliderId} className="sr-only">
        {t("schedule.view.time")}
      </label>
      <input
        id={sliderId}
        className="vm-time-slider"
        type="range"
        min={0}
        max={47}
        step={1}
        value={cell}
        disabled={!at}
        aria-valuetext={readout}
        onChange={(e) => at && onPick({ weekday: at.weekday, minute: Number(e.target.value) * 30 })}
      />
      <span className="vm-time-readout mono">{readout}</span>
      <span className="vm-time-note">{t("schedule.view.hostNote")}</span>
    </section>
  );
}
