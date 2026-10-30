#!/usr/bin/env node
// 引导窗口流程规则检查 (零依赖, Node 22.18+ 原生 type stripping 直接 import 纯 TS 模块)。
//   步骤前进 / 后退、进度存档解析、窗口显隐、哪条订阅可以删、哪些厂商能在窗口里添加
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${ROOT}src/`;

// 与 check-slot-schedule.mjs 相同的解析钩子: `@/x` → src/x(.ts); `.ts` 里的无扩展名相对路径补 `.ts`
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

const {
  DEFAULT_WIZARD, parseWizardState, nextStep, prevStep, canSkip, isWizardVisible,
  canDiscardSubscription, providerEntry, inlineEndpoints, filledTierCount, isLocale,
} = await import(pathToFileURL(`${SRC}lib/onboardingFlow.ts`).href);

// ---- 进度存档 ----
check("parse null → default", same(parseWizardState(null), DEFAULT_WIZARD));
check("parse garbage → default", same(parseWizardState("{oops"), DEFAULT_WIZARD));
check("parse non-object → default", same(parseWizardState("[1,2]"), DEFAULT_WIZARD));
check(
  "parse unknown step → default step",
  parseWizardState(JSON.stringify({ ...DEFAULT_WIZARD, step: "nope" })).step === "appearance",
);
const saved = { ...DEFAULT_WIZARD, step: "models", subscriptionId: "abc", source: "wizard" };
check("round trip", same(parseWizardState(JSON.stringify(saved)), saved));
check(
  "parse drops extra keys (no api key leaks back)",
  !("apiKey" in parseWizardState(JSON.stringify({ ...saved, apiKey: "sk-x" }))),
);
check(
  "parse rejects wrong types field by field",
  same(
    parseWizardState(JSON.stringify({ ...saved, subscriptionId: 42, dismissed: "yes" })),
    { ...saved, subscriptionId: null, dismissed: false },
  ),
);

// ---- 前进 / 后退 ----
check("next appearance", nextStep({ step: "appearance", source: null }) === "terms");
check("next subscription (wizard)", nextStep({ step: "subscription", source: "wizard" }) === "models");
check("next subscription (page)", nextStep({ step: "subscription", source: "page" }) === "connect");
check("next subscription (import)", nextStep({ step: "subscription", source: "import" }) === "connect");
check("next models", nextStep({ step: "models", source: "wizard" }) === "connect");
check("next done", nextStep({ step: "done", source: "wizard" }) === null);
check("prev connect (wizard)", prevStep({ step: "connect", source: "wizard" }) === "models");
check("prev connect (page)", prevStep({ step: "connect", source: "page" }) === "subscription");
check("prev terms", prevStep({ step: "terms", source: null }) === "appearance");
check("prev appearance", prevStep({ step: "appearance", source: null }) === null);

check("skip needs disclaimer", canSkip(false) === false && canSkip(true) === true);

// ---- 显隐 ----
const vis = (o) =>
  isWizardVisible({ completed: false, dismissed: false, reopened: false, pathname: "/virtual-models", ...o });
check("visible when not completed", vis({}) === true);
check("hidden while loading", vis({ completed: undefined }) === false);
check("hidden after dismiss", vis({ dismissed: true }) === false);
check("hidden when completed", vis({ completed: true }) === false);
check("reopened shows even if completed", vis({ completed: true, reopened: true }) === true);
check("hidden on full add page", vis({ pathname: "/subscriptions/new" }) === false);
check("hidden on full add page even if reopened", vis({ pathname: "/subscriptions/new", reopened: true }) === false);

// ---- 订阅清理 ----
// 本窗口建的、还没在第 4 步「下一步」确认的订阅可以删 (测试连接会先写真实槽位, 所以不能按槽位判断)
check("discard own unconfirmed", canDiscardSubscription({ source: "wizard", confirmed: false }) === true);
check("keep own confirmed", canDiscardSubscription({ source: "wizard", confirmed: true }) === false);
check("keep page-created", canDiscardSubscription({ source: "page", confirmed: false }) === false);
check("keep imported", canDiscardSubscription({ source: "import", confirmed: false }) === false);
check("keep unknown source", canDiscardSubscription({ source: null, confirmed: false }) === false);
check(
  "confirmed round trips and defaults false",
  parseWizardState(JSON.stringify({ ...saved, confirmed: true })).confirmed === true &&
    parseWizardState(JSON.stringify(saved)).confirmed === false,
);

// ---- 完成页摘要 ----
const pending = { fable: "(pending)", opus: "(pending)", sonnet: "(pending)", haiku: "(pending)" };
check("pending tiers are not counted", filledTierCount(pending) === 0);
check("empty tiers are not counted", filledTierCount({ fable: "m", opus: " ", sonnet: "", haiku: "(pending)" }) === 1);
check("all tiers counted", filledTierCount({ fable: "a", opus: "b", sonnet: "c", haiku: "d" }) === 4);
check("known locales", ["zh", "zh-Hant", "en", "ja"].every(isLocale));
check("unknown language values", !isLocale("fr") && !isLocale("system") && !isLocale(undefined));

// ---- 厂商入口 ----
const ep = (id, protocol = "messages") => ({
  id, label: id, base_url: "https://x", messages_path: "/v1/messages", protocol,
  example_models: [], url_params_used: [],
});
const prov = (type, endpoints) => ({ id: type, auth: { type }, endpoints });
check("api_key with messages → inline", providerEntry(prov("api_key", [ep("a")])) === "inline");
check(
  "translated api key → inline",
  providerEntry(prov("openai_responses_api_key", [ep("a")])) === "inline" &&
    providerEntry(prov("gemini_api_key", [ep("a")])) === "inline" &&
    providerEntry(prov("gemini_interactions_api_key", [ep("a")])) === "inline" &&
    providerEntry(prov("openai_chat_completions_api_key", [ep("a")])) === "inline",
);
check("chatgpt oauth → page", providerEntry(prov("chatgpt_oauth", [ep("a")])) === "page");
check("kiro oauth → page", providerEntry(prov("kiro_oauth", [ep("a")])) === "page");
check(
  "systemone-only → hidden",
  providerEntry(prov("api_key", [ep("s", "systemone")])) === "hidden",
);
check(
  "inline endpoints drop systemone",
  same(inlineEndpoints(prov("api_key", [ep("a"), ep("s", "systemone"), ep("b")])).map((e) => e.id), ["a", "b"]),
);

if (failures.length) {
  console.error(`check-onboarding: ${failures.length} 项失败\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("check-onboarding: 全部通过");
