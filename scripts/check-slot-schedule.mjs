#!/usr/bin/env node
// 槽位分时段规则的前端求值检查 (零依赖, Node 22.18+ 原生 type stripping 直接 import 纯 TS 模块)。
//   1. src/lib/slot-schedule-cases.json: 与 Rust `subscription::schedule` 的测试读同一份
//   2. 日型分组 / 遮蔽检测 / 校验 / 时段合并 / 色块稳定性
//   3. 源码扫描: 求值与日历组件不得用 `new Date(` 推算星期 / 时刻
import { registerHooks } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${ROOT}src/`;

// 与 check-i18n.mjs 相同的解析钩子: `@/x` → src/x(.ts); `.ts` 里的无扩展名相对路径补 `.ts`
const isFile = (p) => existsSync(p) && statSync(p).isFile();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromTs = context.parentURL?.endsWith(".ts");
    let base = null;
    if (specifier.startsWith("@/")) base = SRC + specifier.slice(2);
    else if (fromTs && specifier.startsWith(".") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    if (base) {
      for (const cand of [base, `${base}.ts`, `${base}/index.ts`]) {
        if (isFile(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readJson = (rel) => JSON.parse(readFileSync(ROOT + rel, "utf8"));

const {
  effectiveModel, clockAt, weekCells, groupDayTypes, runs, weeklyHours, ruleIssues, validateRules, HALF_HOURS,
  dayPreset, DAY_PRESETS, crossesMidnight, normalizeSchedules, schedulesEqual, isNowSelection,
} = await import("../src/lib/slotSchedule.ts");
const { modelColor, assignModelColors } = await import("../src/lib/modelColor.ts");

// ---- 1. 共享用例表 ----
const toMinute = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const cases = readJson("src/lib/slot-schedule-cases.json");
check("用例表非空", cases.length >= 15, `实际 ${cases.length}`);
for (const c of cases) {
  const got = effectiveModel(c.default, c.rules, { weekday: c.at.weekday, minute: toMinute(c.at.time) });
  check(`case: ${c.name}`, got === c.expect, `期望 ${JSON.stringify(c.expect)}, 实际 ${JSON.stringify(got)}`);
}

// 用例表没钉住的求值行为 (Rust 侧有对应单测)
const R = (days, start, end, model) => ({ days, start, end, model });
const ALL = [1, 2, 3, 4, 5, 6, 7];
const mon10 = { weekday: 1, minute: 600 };
check("畸形规则被跳过", effectiveModel("", [R([1], "garbage", "18:00", "bad"), R([1], "8:00", "18:00", "bad"), R([1], "24:00", "08:00", "bad"), R([1], "08:00", "08:00", "bad"), R([1], "08:00", "18:00", "good")], mon10) === "good");
check("结果 trim", effectiveModel("", [R([1], "08:00", "18:00", "  m  ")], mon10) === "m");
check("默认值 trim", effectiveModel(" d ", [], mon10) === "d");

// ---- 2. 分组 / 遮蔽 / 校验 ----
const qoder = [R([1, 2, 3, 4, 5], "08:00", "18:00", "deepseek-4.1"), R([1, 2, 3, 4, 5], "18:00", "08:00", "qwen-max")];
const qCells = weekCells((at) => effectiveModel("", qoder, at));
check("weekCells 长度", qCells.length === HALF_HOURS && HALF_HOURS === 336);
check("clockAt(0)=周一 00:00", same(clockAt(0), { weekday: 1, minute: 0 }));
check("clockAt(335)=周日 23:30", same(clockAt(335), { weekday: 7, minute: 1410 }));
const groups = groupDayTypes(qCells, (v) => v ?? "");
check("qoder 日型分组", same(groups.map((g) => g.days), [[1], [2, 3, 4, 5], [6], [7]]), JSON.stringify(groups.map((g) => g.days)));
check("每组 48 格", groups.every((g) => g.cells.length === 48));

const shadow = ruleIssues([R(ALL, "00:00", "24:00", "a"), R(ALL, "10:00", "11:00", "b")]);
check("被盖住的规则报 shadowed", same(shadow, [{ index: 1, kind: "shadowed" }]), JSON.stringify(shadow));
check("正常规则无提示", ruleIssues(qoder).length === 0);
// 「被上面的时段盖住」只看排在前面的规则: 被后面的同模型规则覆盖不算, 重复规则只报后一条
check("被后面的规则覆盖不算被盖住", ruleIssues([R(ALL, "10:00", "11:00", "a"), R(ALL, "00:00", "24:00", "a")]).length === 0);
check("重复规则只报后一条", same(ruleIssues([R(ALL, "00:00", "08:00", "a"), R(ALL, "00:00", "08:00", "a")]), [{ index: 1, kind: "shadowed" }]));
check("起止相同报 same_start_end", same(ruleIssues([R([1], "08:00", "08:00", "a")]), [{ index: 0, kind: "same_start_end" }]));

check("validateRules 通过 qoder", validateRules(qoder) === null);
for (const [name, rules, key] of [
  ["days 空", [R([], "08:00", "18:00", "m")], "schedule.err.days_empty"],
  ["days 越界", [R([8], "08:00", "18:00", "m")], "schedule.err.days_range"],
  ["days 重复", [R([1, 1], "08:00", "18:00", "m")], "schedule.err.days_dup"],
  ["开始 08:15", [R([1], "08:15", "18:00", "m")], "schedule.err.start_format"],
  ["开始 24:00", [R([1], "24:00", "08:00", "m")], "schedule.err.start_24"],
  ["结束 18:20", [R([1], "08:00", "18:20", "m")], "schedule.err.end_format"],
  ["起止相同", [R([1], "08:00", "08:00", "m")], "schedule.err.same"],
  ["模型空白", [R([1], "08:00", "18:00", "  ")], "schedule.err.model_empty"],
  ["17 条", Array.from({ length: 17 }, () => R([1], "08:00", "18:00", "m")), "schedule.err.too_many"],
  ["思考强度未知", [{ ...R([1], "08:00", "18:00", "m"), effort: "turbo" }], "schedule.err.effort"],
  ["思考强度 minimal 不在槽位档位", [{ ...R([1], "08:00", "18:00", "m"), effort: "minimal" }], "schedule.err.effort"],
]) {
  const got = validateRules(rules);
  check(`validateRules: ${name}`, got === key, `期望 ${key}, 实际 ${got}`);
}
check("validateRules 接受时段思考强度 xhigh", validateRules([{ ...R([1], "08:00", "18:00", "m"), effort: "xhigh" }]) === null);
check("validateRules 接受 24:00 结束与 16 条", validateRules([R([7], "00:30", "24:00", "m")]) === null
  && validateRules(Array.from({ length: 16 }, () => R([1], "08:00", "18:00", "m"))) === null);

check("weeklyHours 全周", weeklyHours("d", []) === 168);
check("weeklyHours 无默认无规则", weeklyHours("", []) === 0);
check("weeklyHours qoder", weeklyHours("", qoder) === 120, String(weeklyHours("", qoder)));

const monday = qCells.slice(0, 48);
const rs = runs(monday, (v) => v ?? "");
check("runs 周一", same(rs.map((r) => [r.start, r.end, r.value]), [[0, 16, null], [16, 36, "deepseek-4.1"], [36, 48, "qwen-max"]]), JSON.stringify(rs));

// 编辑页用的小工具: 星期快捷项识别 / 跨零点 / 草稿与已存配置比较
check("dayPreset 每天", dayPreset([7, 1, 2, 3, 4, 5, 6]) === "every");
check("dayPreset 工作日", dayPreset([1, 2, 3, 4, 5]) === "workdays");
check("dayPreset 周末", dayPreset([7, 6]) === "weekend");
check("dayPreset 自定义", dayPreset([1, 3]) === "custom" && dayPreset([]) === "custom" && dayPreset([1, 1, 2, 3, 4, 5]) === "custom");
check("DAY_PRESETS 升序", same(DAY_PRESETS.every, ALL) && same(DAY_PRESETS.workdays, [1, 2, 3, 4, 5]) && same(DAY_PRESETS.weekend, [6, 7]));
check("crossesMidnight", crossesMidnight("18:00", "08:00") && !crossesMidnight("18:00", "24:00")
  && !crossesMidnight("08:00", "18:00") && !crossesMidnight("08:00", "08:00") && !crossesMidnight("bad", "08:00"));
check("normalizeSchedules 去空列表并固定槽位顺序",
  same(normalizeSchedules({ haiku: [qoder[0]], fable: [], opus: qoder }), { opus: qoder, haiku: [qoder[0]] }));
check("schedulesEqual 忽略空列表与键顺序", schedulesEqual({ sonnet: [], opus: qoder }, { opus: qoder }));
check("schedulesEqual 规则不同", !schedulesEqual({ opus: qoder }, { opus: [qoder[1], qoder[0]] }));

const c1 = modelColor("deepseek-4.1");
check("modelColor 同名同色", same(c1, modelColor("deepseek-4.1")));
check("modelColor 引用主题变量", /^var\(--fill-/.test(c1.bg) && c1.bar.includes("var(--fill-"));
check("modelColor 不是单一颜色", new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((m) => modelColor(m).bg)).size > 1);
const trio = ["deepseek-4.1", "qwen-max", "mimo-v2.6-pro"];
const assigned = assignModelColors(trio);
check("assignModelColors 三个模型三种颜色", new Set(trio.map((m) => assigned.get(m)?.bg)).size === 3);
const reordered = assignModelColors(["qwen-max", "mimo-v2.6-pro", "deepseek-4.1", "qwen-max"]);
check("assignModelColors 与传入顺序无关", same([...assigned].sort(), [...reordered].sort()));
check("assignModelColors 引用主题变量", [...assigned.values()].every((c) => /^var\(--fill-/.test(c.bg)));
// 色条用同色系深色 token, 不能混 --ink-*: 暗色下 ink 是浅色, 混出来全是灰
check("色条不混墨色", [...assigned.values(), c1].every((c) => /^var\(--fill-[a-z-]+-bar\)$/.test(c.bar)), c1.bar);
{
  const css = readFileSync(`${SRC}styles.css`, "utf8");
  const fills = new Set([...assignModelColors(["a", "b", "c", "d", "e", "f", "g", "h", "i"]).values()].map((c) => c.bar));
  for (const bar of fills) {
    const token = bar.slice(4, -1);
    const n = css.split(`${token}:`).length - 1;
    check(`${token} 亮 / 暗主题各定义一次`, n === 2, `实际 ${n}`);
  }
}

// ---- 2a. 虚拟模型页「现在」判定: 没有固定选择, 或所选恰为宿主机此刻所在半小时格 ----
{
  const host = { weekday: 3, minute: 614 };
  check("现在: 无选择即现在", isNowSelection(null, host) && isNowSelection(null, null));
  check("现在: 选了同星期同半小时格 (如点已高亮的星期) 仍是现在", isNowSelection({ weekday: 3, minute: 600 }, host));
  check("现在: 同星期不同半小时格不是", !isNowSelection({ weekday: 3, minute: 630 }, host));
  check("现在: 同半小时格不同星期不是", !isNowSelection({ weekday: 4, minute: 600 }, host));
  check("现在: 宿主机时钟未取到时固定选择不算现在", !isNowSelection({ weekday: 3, minute: 600 }, null));
}

// ---- 2b. 此刻生效模型 (列表 / 实时路由) ----
const { slotModelAt, slotNow } = await import("../src/lib/slotNow.ts");

const SUB = (id, slots, schedules = {}, extra = {}) => ({
  id,
  display_name: id,
  enabled: true,
  state: "healthy",
  model_slots: { fable: "", opus: "", sonnet: "", haiku: "", ...slots },
  slot_schedules: schedules,
  slot_models_now: { fable: null, opus: "from-backend", sonnet: null, haiku: null },
  ...extra,
});
const sat7 = { weekday: 6, minute: 420 };
const qSub = SUB("qoder", { opus: "" }, { opus: qoder });
check("slotModelAt 按规则", slotModelAt(qSub, "opus", mon10) === "deepseek-4.1");
check("slotModelAt 周六早上 (周五夜跨零点)", slotModelAt(qSub, "opus", sat7) === "qwen-max");
check("slotModelAt 周日空档", slotModelAt(qSub, "opus", { weekday: 7, minute: 600 }) === null);
check("slotNow 分时段", same(slotNow(qSub, "opus", mon10), { model: "deepseek-4.1", scheduled: true, neverCalled: false }));
check("slotNow 不会被调用", same(slotNow(SUB("e", {}), "haiku", mon10), { model: null, scheduled: false, neverCalled: true }));
check("slotNow 全天默认", same(slotNow(SUB("d", { sonnet: " m " }), "sonnet", mon10), { model: "m", scheduled: false, neverCalled: false }));
check("slotNow 时钟未到时用后端求值", slotNow(qSub, "opus", null).model === "from-backend");
const VM = (ids, mode = "sequential", name = "model-opus") => ({ name, mode, subscription_ids: ids });

// ---- 2c. 订阅编辑页: ?slot= 初始标签与「列表外」提示 ----
const { parseSlotParam } = await import("../src/lib/modelSlots.ts");
const { outsideModelList } = await import("../src/lib/slotSchedule.ts");
check("?slot= 四槽原样", ["fable", "opus", "sonnet", "haiku"].every((k) => parseSlotParam(k) === k));
check("?slot= 非法值忽略", [null, "", "fallback", "jev", "OPUS", " opus", "model-opus"].every((v) => parseSlotParam(v) === null));
check("列表外: 有列表且不在其中", outsideModelList("x", ["a", "b"]));
check("列表外: 在列表里不算", !outsideModelList("a", ["a", "b"]));
check("列表外: 空值不算", !outsideModelList("", ["a"]));
check("列表外: 没有模型列表时不提示", !outsideModelList("x", []));

// ---- 2d. 虚拟模型页路由图 (第二版): 订阅 → 每条规则一行 + 收尾行, 线条随所选时刻 ----
{
  const { buildRouteMap, stablyAvailable, pageModelColors } = await import("../src/components/schedule/routeMap.ts");
  const WD = [1, 2, 3, 4, 5];
  const qoderOpus = [R(WD, "08:00", "18:00", "deepseek-4.1"), R(WD, "18:00", "08:00", "qwen-max")];
  const rq = SUB("qoder", {}, { opus: qoderOpus, haiku: [R(WD, "08:00", "18:00", "qoder-DeepSeek-Flash")] });
  const rd = SUB("DeepSeek", {}, {
    opus: [R(ALL, "00:30", "08:30", "deepseek-v4-pro")],
    haiku: [R(ALL, "00:30", "08:30", "deepseek-v4-flash")],
  });
  const ra = SUB("Aiberm", { opus: "gpt-6.1-sol" });
  const rc = SUB("cool", { opus: "z-model" }, {}, { state: "transient_error" });
  const rOff = SUB("off", { opus: "x-model" }, {}, { enabled: false });
  const rmap = new Map([rq, rd, ra, rc, rOff].map((s) => [s.id, s]));
  const wed10 = { weekday: 3, minute: 600 };
  const activeRow = (g) => g.rows.find((r) => r.active);
  const opusSeq = VM(["qoder", "DeepSeek", "Aiberm"]);

  const m1 = buildRouteMap(opusSeq, rmap, wed10, true);
  const [gq, gd, ga] = m1.groups;
  check("路由图: 每个绑定订阅一组, 按绑定顺序", same(m1.groups.map((g) => g.sub.id), ["qoder", "DeepSeek", "Aiberm"]));
  check("路由图: qoder 两条规则 + 收尾「其余时间 · 不参与」",
    same(gq.rows.map((r) => [r.kind, r.model]), [["rule", "deepseek-4.1"], ["rule", "qwen-max"], ["restOff", null]]));
  check("路由图: 规则行标签与星期", same(gq.rows[0].label, { key: "schedule.map.rule", params: { start: "08:00", end: "18:00" } })
    && same(gq.rows[1].label, { key: "schedule.map.ruleNextDay", params: { start: "18:00", end: "08:00" } })
    && same(gq.rows[0].days, WD) && gq.rows[2].days === null);
  check("路由图: 周三 10:00 qoder 首选 deepseek-4.1",
    gq.rank === "first" && activeRow(gq).model === "deepseek-4.1" && activeRow(gq).tag === "first");
  check("路由图: 四槽行 usable = 有模型", same(gq.rows.map((r) => r.usable), [true, true, false]) && ga.rows[0].usable === true);
  check("路由图: 每组只有一行命中, 未命中行无标记", m1.groups.every((g) => g.rows.filter((r) => r.active).length === 1
    && g.rows.every((r) => r.active || r.tag === null)));
  check("路由图: DeepSeek 命中「其余时间 · 不参与」", activeRow(gd).kind === "restOff" && gd.rank === null && activeRow(gd).tag === "off");
  check("路由图: Aiberm 全天行, 备选", same(ga.rows.map((r) => r.kind), ["all"]) && ga.rank === "backup"
    && activeRow(ga).tag === "backup" && same(ga.rows[0].days, ALL));
  check("路由图: 顺序摘要", same(m1.summary, { kind: "first", sub: "qoder", model: "deepseek-4.1" }), JSON.stringify(m1.summary));

  const sat0730 = buildRouteMap(opusSeq, rmap, { weekday: 6, minute: 450 }, false).groups[0];
  check("路由图: 周六 07:30 qoder 命中周五夜跨来的规则", activeRow(sat0730) === sat0730.rows[1]);
  const sat0800 = buildRouteMap(opusSeq, rmap, { weekday: 6, minute: 480 }, false).groups[0];
  check("路由图: 周六 08:00 qoder 不参与", activeRow(sat0800).kind === "restOff" && sat0800.rank === null);

  const segOn = (wd) => buildRouteMap(opusSeq, rmap, { weekday: wd, minute: 600 }, false).groups[0].rows[1].segments;
  check("路由图: qwen-max 周六时间条", same(segOn(6), [{ from: 0, to: 16 }]), JSON.stringify(segOn(6)));
  check("路由图: qwen-max 周一时间条", same(segOn(1), [{ from: 36, to: 48 }]), JSON.stringify(segOn(1)));
  check("路由图: 收尾行时间条 = 规则都不命中的时段",
    same(buildRouteMap(opusSeq, rmap, wed10, false).groups[1].rows[1].segments, [{ from: 0, to: 1 }, { from: 17, to: 48 }]));
  check("路由图: 全天行时间条", same(ga.rows[0].segments, [{ from: 0, to: 48 }]));
  check("路由图: 空槽位一行「不会被调用」", same(buildRouteMap(VM(["qoder"], "sequential", "model-sonnet"), rmap, wed10, false)
    .groups[0].rows.map((r) => [r.kind, r.model, r.label.key]), [["empty", null, "schedule.map.empty"]]));
  {
    const withDef = SUB("wd", { opus: "base" }, { opus: [qoderOpus[0]] });
    const g = buildRouteMap(VM(["wd"]), new Map([["wd", withDef]]), { weekday: 7, minute: 600 }, false).groups[0];
    check("路由图: 有规则有默认时收尾「其余时间」+ 默认模型",
      same(g.rows[1], { ...g.rows[1], kind: "rest", model: "base", active: true, tag: "first", days: null }));
  }
  // 命中行与求值函数在一周每个半小时格都一致 (不是第三份求值)
  {
    let agree = true;
    for (let i = 0; i < HALF_HOURS && agree; i++) {
      const at = clockAt(i);
      buildRouteMap(VM(["qoder", "DeepSeek", "Aiberm"], "sequential", "model-haiku"), rmap, at, false).groups.forEach((g) => {
        if ((activeRow(g)?.model ?? null) !== slotModelAt(g.sub, "haiku", at)) agree = false;
      });
    }
    check("路由图: 命中行模型与 slotModelAt 逐格一致", agree);
  }

  const coolVm = VM(["cool", "Aiberm"]);
  const cNow = buildRouteMap(coolVm, rmap, wed10, true);
  check("路由图: 现在时刻冷却订阅被跳过", cNow.groups[0].skipped === "cooldown" && cNow.groups[0].rank === null
    && activeRow(cNow.groups[0]).tag === "skipped" && cNow.groups[1].rank === "first" && cNow.summary.sub === "Aiberm");
  const cLater = buildRouteMap(coolVm, rmap, wed10, false);
  check("路由图: 别的时刻冷却不影响", cLater.groups[0].skipped === null && cLater.groups[0].rank === "first"
    && cLater.groups[1].rank === "backup");
  {
    const rl = SUB("rl", { opus: "m" }, {}, { state: "rate_limited" });
    const full = SUB("full", { opus: "m" }, {}, { is_dispatchable: false });
    const mm = new Map([rl, full].map((s) => [s.id, s]));
    check("路由图: 限流 / 限额已满的跳过原因",
      same(buildRouteMap(VM(["rl", "full"]), mm, wed10, true).groups.map((g) => g.skipped), ["rate_limited", "quota"]));
  }
  const offMap = buildRouteMap(VM(["off", "Aiberm"]), rmap, wed10, false);
  check("路由图: 停用订阅全周不参与", offMap.groups[0].rank === null && offMap.groups[0].skipped === null
    && activeRow(offMap.groups[0]).tag === "off" && offMap.groups[1].rank === "first");
  check("路由图: stablyAvailable 停用 / 凭证失效为假, 瞬时状态为真",
    !stablyAvailable(rOff) && !stablyAvailable(SUB("bad", {}, {}, { state: "auth_failed" })) && stablyAvailable(rc)
    && stablyAvailable(SUB("rl", {}, {}, { state: "rate_limited" })));
  check("路由图: 凭证失效订阅全周不参与", buildRouteMap(VM(["bad"]), new Map([["bad", SUB("bad", { opus: "m" }, {}, { state: "auth_failed" })]]), wed10, false)
    .groups[0].rank === null);
  check("路由图: 缺失的订阅不画", buildRouteMap(VM(["ghost", "Aiberm"]), rmap, wed10, false).groups.length === 1);

  const rr = buildRouteMap(VM(["qoder", "DeepSeek", "Aiberm"], "round_robin"), rmap, wed10, false);
  check("路由图: 轮询下可用订阅都参与", same(rr.groups.map((g) => g.rank), ["join", null, "join"])
    && activeRow(rr.groups[0]).tag === "rr" && activeRow(rr.groups[2]).tag === "rr");
  check("路由图: 轮询摘要", same(rr.summary, { kind: "rr", n: 2 }), JSON.stringify(rr.summary));
  const st = buildRouteMap(VM(["qoder", "Aiberm"], "sticky"), rmap, wed10, false);
  check("路由图: 会话亲和", same(st.summary, { kind: "sticky", n: 2 }) && activeRow(st.groups[0]).tag === "sticky");
  const none = buildRouteMap(VM(["DeepSeek"]), rmap, wed10, false);
  check("路由图: 没有可用订阅", same(none.summary, { kind: "none" }));

  const haiku = buildRouteMap(VM(["DeepSeek", "qoder"], "sequential", "model-haiku"), rmap, wed10, false);
  check("路由图: haiku 一周缺口小时数", haiku.gapHours === 64.5, String(haiku.gapHours));
  check("路由图: haiku 第一个缺口", same(haiku.firstGap, { weekday: 1, from: 0, to: 1 }), JSON.stringify(haiku.firstGap));
  check("路由图: opus 例没有缺口", m1.gapHours === 0 && m1.firstGap === null);
  check("路由图: 缺口不看瞬时状态", buildRouteMap(VM(["cool"]), rmap, wed10, true).gapHours === 0);
  check("路由图: 周日夜不跨到周一, 缺口从周一 0 点起", same(buildRouteMap(VM(["qoder"]), rmap, wed10, false).firstGap, { weekday: 1, from: 0, to: 16 }));
  {
    const monAm = SUB("monAm", {}, { opus: [R([1], "00:00", "12:00", "m")] });
    check("路由图: 缺口第一段截到当天结束",
      same(buildRouteMap(VM(["monAm"]), new Map([["monAm", monAm]]), wed10, false).firstGap, { weekday: 1, from: 24, to: 48 }));
  }

  const fbSubs = new Map([
    ["pass", SUB("pass", {}, {}, { auth_type: "api_key" })],
    ["slotted", SUB("slotted", { fallback: " fb-model " }, {}, { auth_type: "openai_responses_api_key" })],
    ["trans", SUB("trans", {}, {}, { auth_type: "gemini_api_key" })],
  ]);
  const fb = buildRouteMap(VM(["pass", "slotted", "trans"], "sequential", "model-fallback"), fbSubs, wed10, false);
  check("路由图: fallback 每订阅一行 fixed、不画星期", fb.groups.every((g) => g.rows.length === 1 && g.rows[0].kind === "fixed"
    && g.rows[0].days === null && g.rows[0].active && same(g.rows[0].segments, [{ from: 0, to: 48 }])));
  check("路由图: fallback 透传 / 兜底槽 / 翻译类未配兜底槽被跳过",
    same(fb.groups.map((g) => [g.rows[0].model, g.rank]), [[null, "first"], ["fb-model", "backup"], [null, null]]));
  check("路由图: fallback 行 usable (翻译类未配兜底槽为假)", same(fb.groups.map((g) => g.rows[0].usable), [true, true, false]));
  check("路由图: fallback 没有缺口概念", fb.gapHours === 0 && fb.firstGap === null);
  check("路由图: fallback 摘要的透传模型为空", same(fb.summary, { kind: "first", sub: "pass" }), JSON.stringify(fb.summary));
  const jevSubs = new Map([
    ["j1", SUB("j1", { jev: "clef-pro" }, {}, { model_discovery: { example_models: [] } })],
    ["j2", SUB("j2", {}, {}, { model_discovery: { example_models: ["ex-model"] } })],
    ["j3", SUB("j3", {}, {}, { model_discovery: { example_models: [] } })],
  ]);
  const jv = buildRouteMap(VM(["j1", "j2", "j3"], "sequential", "model-jev"), jevSubs, wed10, false);
  check("路由图: jev 行 Jev 槽 / 端点示例模型 / 透传",
    same(jv.groups.map((g) => [g.rows[0].kind, g.rows[0].model, g.rows[0].days]), [["fixed", "clef-pro", null], ["fixed", "ex-model", null], ["fixed", null, null]]));
  check("路由图: jev 行都 usable (透传也会发请求)", jv.groups.every((g) => g.rows[0].usable));

  // 整页一张配色表: 全部虚拟模型 (含 fallback 兜底槽与 jev 模型) 各行的模型; 缺失订阅不计
  const pageSubs = new Map([...rmap,
    ["Aiberm", SUB("Aiberm", { opus: "gpt-6.1-sol", sonnet: "gpt-6.1-sol", fallback: "fb-only" })],
    ["j1", SUB("j1", { jev: "jev-only" }, {}, { model_discovery: { example_models: [] } })]]);
  const pageColors = pageModelColors(
    [VM(["qoder", "ghost"]), VM(["DeepSeek", "Aiberm"], "round_robin", "model-sonnet"),
      VM(["Aiberm"], "sequential", "model-fallback"), VM(["j1"], "sequential", "model-jev")],
    pageSubs,
  );
  const pageModels = ["deepseek-4.1", "fb-only", "gpt-6.1-sol", "jev-only", "qwen-max"];
  check("路由图: 整页配色覆盖所有卡片 (含 fallback / jev) 的模型",
    same([...pageColors.keys()].sort(), pageModels), JSON.stringify([...pageColors.keys()]));
  check("路由图: 整页配色互不相同", new Set([...pageColors.values()].map((c) => c.bg)).size === pageColors.size);
  {
    const four = ["deepseek-4.1", "gpt-6.1-sol", "qwen-max"].map((m) => pageColors.get(m)?.bar);
    check("路由图: fallback / jev 专属模型与四槽模型不撞色",
      ["fb-only", "jev-only"].every((m) => pageColors.get(m) && !four.includes(pageColors.get(m).bar)));
  }
  check("路由图: 整页配色与 assignModelColors 同一张表", same([...pageColors], [...assignModelColors(pageModels)]));
}

// ---- 3. 源码扫描: 不得用 new Date( 推算星期 / 时刻 ----
const scan = [`${SRC}lib/slotSchedule.ts`, `${SRC}lib/slotNow.ts`];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) scan.push(p);
  }
};
walk(`${SRC}components/schedule`);
for (const p of scan) {
  check(`${p.slice(ROOT.length)} 不得出现 new Date(`, !/new\s+Date\s*\(/.test(readFileSync(p, "utf8")));
}

if (failures.length) {
  console.error(`check-slot-schedule: ${failures.length} 项失败\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("check-slot-schedule: 全部通过");
