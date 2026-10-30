import { useMemo, useState } from "react";
import { Copy, Plus, X } from "lucide-react";
import { useT, type TFunction } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelect, SlotEffortSelect } from "@/components/ModelSlotPicker";
import { DayTypeCalendar, type Cell } from "./DayTypeCalendar";
import { assignModelColors, modelColor } from "@/lib/modelColor";
import { MODEL_SLOT_KEYS } from "@/lib/modelSlots";
import {
  DAY_PRESETS,
  MAX_RULES_PER_SLOT,
  crossesMidnight,
  dayPreset,
  effectiveModel,
  hhmm,
  outsideModelList,
  ruleIssues,
  validateRules,
  weekCells,
  weeklyHours,
  type DayPreset,
} from "@/lib/slotSchedule";
import type {
  FourSlot,
  ModelInfo,
  ModelSlots,
  ScheduleRule,
  SlotEffort,
  SlotEfforts,
  SlotSchedules,
} from "@/types";

/** 开始 00:00..23:30, 结束 00:30..24:00 (30 分钟粒度, spec §3) */
const START_TIMES = Array.from({ length: 48 }, (_, i) => hhmm(i * 30));
const END_TIMES = Array.from({ length: 48 }, (_, i) => hhmm((i + 1) * 30));
const PRESET_ORDER: DayPreset[] = ["every", "workdays", "weekend", "custom"];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const WEEK_HOURS = 168;

/**
 * 订阅编辑页的槽位分时段编辑 (设计稿 `Subscription.dc.html`): 四个槽位标签, 选中槽的默认模型 +
 * 有序时段规则, 右侧按日型合并的一周预览, 下方只提示不拦截的检查。
 * 受控组件: 默认模型就是父组件那份 `slots` (与 ModelSlotPicker 共用), 规则是 `schedules`。
 * 自己只留当前标签、哪些行展开了自定义星期、刚复制过的提示这几样界面状态。
 * 没有模型列表或模型列表切到「手动」时, 默认与规则的模型都是纯文本输入。
 */
export function SlotScheduleEditor({
  slots,
  onSlotsChange,
  schedules,
  onSchedulesChange,
  models,
  manual,
  initialSlot,
  disabled,
  efforts,
  onEffortsChange,
  effortDisabled,
  effortDisabledReason,
}: {
  slots: ModelSlots;
  onSlotsChange: (s: ModelSlots) => void;
  /** 每槽位思考强度 (对该槽所有时段的模型都生效), 与父组件共用一份 */
  efforts: SlotEfforts;
  onEffortsChange: (e: SlotEfforts) => void;
  /** Kiro 等协议没有 reasoning 字段时灰掉, 原因挂 title */
  effortDisabled?: boolean;
  effortDisabledReason?: string;
  schedules: SlotSchedules;
  onSchedulesChange: (s: SlotSchedules) => void;
  models: string[];
  /** ModelSlotPicker 的模型列表处于「手动」模式 */
  manual?: boolean;
  /** 初始标签 (「编辑槽位」链接带的 `?slot=`), 缺省 fable */
  initialSlot?: FourSlot;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [cur, setCur] = useState<FourSlot>(initialSlot ?? "fable");
  const freeText = !!manual || models.length === 0;
  /** 选了「自定义」的行: 星期恰好等于某个快捷项时仍保持七个勾选可见 */
  const [customRows, setCustomRows] = useState<Set<number>>(new Set());
  const [copiedFrom, setCopiedFrom] = useState<FourSlot | null>(null);

  const def = slots[cur];
  const rules = schedules[cur] ?? [];
  const modelInfos = useMemo<ModelInfo[]>(() => models.map((id) => ({ id })), [models]);

  // 一张配色表覆盖本视图出现的全部模型 (四槽默认 + 四槽全部规则), 切标签时颜色不跳
  const colors = useMemo(() => {
    const names: string[] = [];
    for (const k of MODEL_SLOT_KEYS) {
      names.push(slots[k]);
      for (const r of schedules[k] ?? []) names.push(r.model);
    }
    return assignModelColors(names.map((m) => m.trim()).filter((m) => m !== ""));
  }, [slots, schedules]);

  const cells = useMemo<Cell[]>(
    () =>
      weekCells((at) => {
        const m = effectiveModel(def, rules, at);
        return m === null
          ? { key: "", title: "", color: null }
          : { key: m, title: m, color: colors.get(m) ?? modelColor(m) };
      }),
    [def, rules, colors],
  );

  const pickSlot = (k: FourSlot) => {
    setCur(k);
    setCustomRows(new Set());
    setCopiedFrom(null);
  };

  const setRules = (next: ScheduleRule[]) => {
    setCopiedFrom(null);
    onSchedulesChange({ ...schedules, [cur]: next });
  };
  const editRule = (i: number, patch: Partial<ScheduleRule>) =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const removeRule = (i: number) => {
    setCustomRows(
      new Set([...customRows].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))),
    );
    setRules(rules.filter((_, j) => j !== i));
  };

  const addRule = () =>
    setRules([
      ...rules,
      {
        days: [...DAY_PRESETS.every],
        start: "00:00",
        end: "08:00",
        // 没拉过模型列表时退回本槽默认模型, 免得新行一出来就是「模型不能为空」
        model: models[0] ?? def.trim(),
      },
    ]);

  const setPreset = (i: number, p: DayPreset) => {
    const next = new Set(customRows);
    if (p === "custom") {
      next.add(i);
      setCustomRows(next);
      return;
    }
    next.delete(i);
    setCustomRows(next);
    editRule(i, { days: [...DAY_PRESETS[p]] });
  };

  const toggleDay = (i: number, d: number) => {
    const days = rules[i].days;
    editRule(i, {
      days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b),
    });
  };

  const copyToOthers = () => {
    const nextSlots = { ...slots };
    const nextSchedules: SlotSchedules = { ...schedules };
    for (const k of MODEL_SLOT_KEYS) {
      if (k === cur) continue;
      nextSlots[k] = def;
      nextSchedules[k] = rules.map((r) => ({ ...r, days: [...r.days] }));
    }
    onSlotsChange(nextSlots);
    onSchedulesChange(nextSchedules);
    setCopiedFrom(cur);
  };

  // 检查: 校验错误优先; 校验不过的规则不再报「被盖住」(ruleIssues 把畸形规则也算作被盖住)
  const hours = weeklyHours(def, rules);
  const listErr = rules.length > MAX_RULES_PER_SLOT ? validateRules(rules) : null;
  const ruleErrors = rules.map((r) => validateRules([r]));
  const shadowed = new Set(
    ruleIssues(rules)
      .filter((x) => x.kind === "shadowed" && ruleErrors[x.index] === null)
      .map((x) => x.index),
  );
  const unused = def.trim() === "" && rules.length === 0;
  const full = rules.length >= MAX_RULES_PER_SLOT;
  const slotName = `model-${cur}`;

  return (
    <div className="sched-ed">
      <div role="tablist" aria-label={t("schedule.edit.slotsAria")} className="sched-ed-tabs">
        {MODEL_SLOT_KEYS.map((k) => (
          <SlotTab
            key={k}
            slot={k}
            selected={k === cur}
            ruleCount={(schedules[k] ?? []).length}
            hasDefault={slots[k].trim() !== ""}
            onPick={() => pickSlot(k)}
            t={t}
          />
        ))}
      </div>

      <div className="sched-ed-grid" role="tabpanel" aria-label={slotName}>
        <div className="sched-ed-form">
          <div className="sched-ed-def">
            <label htmlFor={`sched-def-${cur}`} className="sched-ed-def-label">
              {t("schedule.edit.default")}
            </label>
            <div className="sched-ed-grow">
              <ModelField
                id={`sched-def-${cur}`}
                noneLabel={t("schedule.edit.defaultNone")}
                current={def}
                models={models}
                modelInfos={modelInfos}
                freeText={freeText}
                disabled={disabled}
                onChange={(v) => {
                  setCopiedFrom(null);
                  onSlotsChange({ ...slots, [cur]: v });
                }}
                t={t}
              />
            </div>
            <div className="sched-ed-effort" title={t("schedule.edit.effortHint")}>
              <span className="sched-ed-effort-label">{t("slotEffort.colLabel")}</span>
              <SlotEffortSelect
                value={efforts[cur]}
                onChange={(v) => {
                  const next = { ...efforts };
                  if (v) next[cur] = v as SlotEffort;
                  else delete next[cur];
                  onEffortsChange(next);
                }}
                disabled={disabled || effortDisabled}
                disabledReason={effortDisabled ? effortDisabledReason : undefined}
                ariaLabel={t("slotEffort.aria", { slot: slotName })}
              />
            </div>
          </div>

          {rules.map((r, i) => (
            <RuleRow
              key={i}
              index={i}
              rule={r}
              custom={customRows.has(i)}
              models={models}
              modelInfos={modelInfos}
              freeText={freeText}
              disabled={disabled}
              onPreset={(p) => setPreset(i, p)}
              onToggleDay={(d) => toggleDay(i, d)}
              onEdit={(patch) => editRule(i, patch)}
              onRemove={() => removeRule(i)}
              effortDisabled={effortDisabled}
              effortDisabledReason={effortDisabledReason}
              t={t}
            />
          ))}

          {rules.length === 0 && (
            <div className="sched-ed-empty">
              {def.trim() !== "" ? t("schedule.edit.noRulesAllDay") : t("schedule.edit.noRules")}
            </div>
          )}

          <div className="sched-ed-actions">
            <button
              type="button"
              className="btn sm"
              onClick={addRule}
              disabled={disabled || full}
            >
              <Plus size={13} />
              {t("schedule.edit.addRule")}
            </button>
            <button
              type="button"
              className="btn sm bare"
              onClick={copyToOthers}
              disabled={disabled}
            >
              <Copy size={13} />
              {t("schedule.edit.copyToOthers")}
            </button>
          </div>

          <div className="sched-ed-checks" aria-live="polite">
            <div>
              {t("schedule.edit.weeklyPrefix")}
              <strong>{t("schedule.edit.hours", { n: hours })}</strong>
              {hours > 0 && hours < WEEK_HOURS &&
                t("schedule.edit.weeklyRest", { n: WEEK_HOURS - hours, slot: slotName })}
            </div>
            {listErr && <div className="err">{t(listErr)}</div>}
            {ruleErrors.map(
              (e, i) =>
                e && (
                  <div key={`e${i}`} className="err">
                    {t("schedule.edit.ruleError", { n: i + 1, msg: t(e) })}
                  </div>
                ),
            )}
            {[...shadowed].map((i) => (
              <div key={`s${i}`} className="warn">
                {t("schedule.edit.shadowed", { n: i + 1 })}
              </div>
            ))}
            {unused && <div className="warn">{t("schedule.edit.unused")}</div>}
            {!unused && hours === 0 && <div className="err">{t("schedule.edit.neverAvailable")}</div>}
            {full && <div className="warn">{t("schedule.err.too_many")}</div>}
            {copiedFrom && (
              <div className="ok">{t("schedule.edit.copied", { slot: `model-${copiedFrom}` })}</div>
            )}
          </div>
        </div>

        <div className="sched-ed-preview" aria-label={t("schedule.edit.previewTitle")}>
          <DayTypeCalendar cells={cells} emptyLabel="unavailable" />
        </div>
      </div>
    </div>
  );
}

function SlotTab({
  slot,
  selected,
  ruleCount,
  hasDefault,
  onPick,
  t,
}: {
  slot: FourSlot;
  selected: boolean;
  ruleCount: number;
  hasDefault: boolean;
  onPick: () => void;
  t: TFunction;
}) {
  const [badge, tone] =
    ruleCount > 0
      ? [t("schedule.edit.badgeTimed", { n: ruleCount }), "accent"]
      : hasDefault
        ? [t("schedule.edit.badgeAllDay"), ""]
        : [t("schedule.edit.badgeUnset"), "err"];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={selected ? "sched-ed-tab on" : "sched-ed-tab"}
      onClick={onPick}
    >
      <span className="sched-ed-tab-dot" style={{ background: `var(--vm-${slot})` }} aria-hidden />
      <span className="mono">{slot}</span>
      <span className={`pill ${tone}`}>{badge}</span>
    </button>
  );
}

function RuleRow({
  index,
  rule,
  custom,
  models,
  modelInfos,
  freeText,
  disabled,
  onPreset,
  onToggleDay,
  onEdit,
  onRemove,
  effortDisabled,
  effortDisabledReason,
  t,
}: {
  index: number;
  rule: ScheduleRule;
  effortDisabled?: boolean;
  effortDisabledReason?: string;
  custom: boolean;
  models: string[];
  modelInfos: ModelInfo[];
  freeText: boolean;
  disabled?: boolean;
  onPreset: (p: DayPreset) => void;
  onToggleDay: (d: number) => void;
  onEdit: (patch: Partial<ScheduleRule>) => void;
  onRemove: () => void;
  t: TFunction;
}) {
  const n = index + 1;
  const preset = custom ? "custom" : dayPreset(rule.days);
  return (
    <div className="sched-ed-rule">
      <div className="sched-ed-rule-line">
        <span className="sched-ed-rule-no hand">{t("schedule.edit.ruleLabel", { n })}</span>
        <Select value={preset} onValueChange={(v) => onPreset(v as DayPreset)} disabled={disabled}>
          <SelectTrigger className="sched-ed-days" aria-label={t("schedule.edit.daysAria", { n })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_ORDER.map((p) => (
              <SelectItem key={p} value={p}>
                {t(`schedule.edit.preset.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TimeSelect
          value={rule.start}
          options={START_TIMES}
          ariaLabel={t("schedule.edit.startAria", { n })}
          disabled={disabled}
          onChange={(v) => onEdit({ start: v })}
        />
        <span className="sched-ed-sep" aria-hidden>
          –
        </span>
        <TimeSelect
          value={rule.end}
          options={END_TIMES}
          ariaLabel={t("schedule.edit.endAria", { n })}
          disabled={disabled}
          onChange={(v) => onEdit({ end: v })}
        />
        {crossesMidnight(rule.start, rule.end) && (
          <span className="pill warn">{t("schedule.edit.nextDay")}</span>
        )}
        <span className="sched-ed-sep" aria-hidden>
          →
        </span>
        <div className="sched-ed-grow">
          <ModelField
            current={rule.model}
            models={models}
            modelInfos={modelInfos}
            freeText={freeText}
            disabled={disabled}
            onChange={(v) => onEdit({ model: v })}
            ariaLabel={t("schedule.edit.modelAria", { n })}
            t={t}
          />
        </div>
        <div className="sched-ed-effort" title={effortDisabled ? effortDisabledReason : t("schedule.edit.ruleEffortHint")}>
          <SlotEffortSelect
            value={rule.effort}
            onChange={(v) => onEdit({ effort: v ? (v as SlotEffort) : undefined })}
            autoLabel={t("schedule.edit.effortFollowSlot")}
            disabled={disabled || effortDisabled}
            disabledReason={effortDisabled ? effortDisabledReason : undefined}
            ariaLabel={t("schedule.edit.ruleEffortAria", { n })}
          />
        </div>
        <button
          type="button"
          className="sched-ed-del"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t("schedule.edit.removeAria", { n })}
          title={t("schedule.edit.removeAria", { n })}
        >
          <X size={14} />
        </button>
      </div>
      {preset === "custom" && (
        <div className="sched-ed-weekdays" role="group" aria-label={t("schedule.edit.daysAria", { n })}>
          {WEEKDAYS.map((d) => {
            const on = rule.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                className={on ? "on" : ""}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggleDay(d)}
              >
                {t("schedule.day.one", { d: t(`schedule.wd.${d}`) })}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 有模型列表 → 可搜索下拉; 没有列表或手动模式 → 纯文本输入 (同 ModelSlotPicker 的两种模式) */
function ModelField({
  id,
  noneLabel,
  current,
  models,
  modelInfos,
  freeText,
  disabled,
  onChange,
  ariaLabel,
  t,
}: {
  id?: string;
  /** 空值是合法选择 (默认模型「不设置」) 时给出; 文本输入下作占位提示 */
  noneLabel?: string;
  current: string;
  models: string[];
  modelInfos: ModelInfo[];
  freeText: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  ariaLabel?: string;
  t: TFunction;
}) {
  if (freeText) {
    return (
      <input
        id={id}
        className="input mono"
        style={{ flex: 1, minWidth: 0 }}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        placeholder={noneLabel ?? t("modelSlot.modelIdPh")}
        aria-label={ariaLabel}
        disabled={disabled}
      />
    );
  }
  return (
    <ModelSelect
      id={id}
      noneLabel={noneLabel}
      current={current}
      models={modelInfos}
      showHistorical={outsideModelList(current, models)}
      disabled={disabled}
      onSelect={onChange}
      ariaLabel={ariaLabel}
      t={t}
    />
  );
}

function TimeSelect({
  value,
  options,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  ariaLabel: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="sched-ed-time mono" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="font-mono">
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
