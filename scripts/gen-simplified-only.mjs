#!/usr/bin/env node
// 生成 src/i18n/simplified-only.txt (简体专用字表), 繁中检查用。只在 OpenCC 词典更新或发现误报时重跑:
//   curl -fsSL -o <dir>/STCharacters.txt \
//     https://raw.githubusercontent.com/BYVoid/OpenCC/ver.1.1.9/data/dictionary/STCharacters.txt
//   curl -fsSL -o <dir>/TWVariants.txt \
//     https://raw.githubusercontent.com/BYVoid/OpenCC/ver.1.1.9/data/dictionary/TWVariants.txt
//   node scripts/gen-simplified-only.mjs <dir>/STCharacters.txt <dir>/TWVariants.txt > src/i18n/simplified-only.txt
// 规则: STCharacters 每行「简体字\t繁体候选…」; 候选里不含简体字本身 → 简体专用。
// 候选含自身的是简繁共用的多义字 (后/後、台/臺、里/裡…), 不收, 否则「皇后」「台灣」会被误报。
// OpenCC 的繁体是传统字形, 台湾正体有时就是简体那个字 (羣→群、牀→床): TWVariants 的目标字一律不收。
import { readFileSync } from "node:fs";

// 起草时发现的误报字放这里 (该字在台湾正体中独立成立), 每个附一句理由。
const ALLOW = new Map([]);

const twForms = new Set();
for (const line of readFileSync(process.argv[3], "utf8").split("\n")) {
  const [, tw] = line.split("\t");
  if (tw) for (const c of tw.trim().split(/\s+/)) twForms.add(c);
}

const chars = [];
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  const [s, cands] = line.split("\t");
  if (!s || !cands || [...s].length !== 1) continue;
  if (cands.trim().split(/\s+/).includes(s) || twForms.has(s) || ALLOW.has(s)) continue;
  chars.push(s);
}
const out = [
  "# 简体专用字表: 繁中文案里出现即视为漏转。由 scripts/gen-simplified-only.mjs 从",
  "# OpenCC ver.1.1.9 的 STCharacters.txt + TWVariants.txt 生成, 不要手改; 误报字加进脚本的 ALLOW 后重跑。",
];
for (let i = 0; i < chars.length; i += 50) out.push(chars.slice(i, i + 50).join(""));
process.stdout.write(out.join("\n") + "\n");
