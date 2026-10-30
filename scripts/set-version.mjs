#!/usr/bin/env node
// 将版本号同步写入 package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml /
// src-tauri/crates/cc-router-tui/Cargo.toml / src-tauri/Cargo.lock。
// 用法：pnpm version:set 0.2.0

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error("用法: pnpm version:set <X.Y.Z>   (例如 0.2.0)");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function updateJson(relPath) {
  const full = resolve(root, relPath);
  const original = readFileSync(full, "utf8");
  const obj = JSON.parse(original);
  obj.version = version;
  // 保留尾部换行
  const trailing = original.endsWith("\n") ? "\n" : "";
  writeFileSync(full, JSON.stringify(obj, null, 2) + trailing);
  console.log(`  ${relPath}  →  ${version}`);
}

function updateCargoToml(relPath) {
  const full = resolve(root, relPath);
  const original = readFileSync(full, "utf8");
  // 只改 [package] 块里第一条 `version = "..."`，避免误伤依赖声明
  let replaced = false;
  const updated = original.replace(
    /^(version\s*=\s*")([^"]*)(")/m,
    (_, p, _old, q) => {
      replaced = true;
      return `${p}${version}${q}`;
    },
  );
  if (!replaced) {
    throw new Error(`未在 ${relPath} 找到顶层 version 字段`);
  }
  writeFileSync(full, updated);
  console.log(`  ${relPath}  →  ${version}`);
}

// Cargo.lock 里本工作区包的 version 也要跟着改, 否则 lock 与 Cargo.toml
// 不一致, CI 用 --frozen/--locked 会失败。只改 name = "<pkg>" 紧跟的那行 version,
// 不动任何依赖条目 (本地包无 checksum, 这一行就是 cargo 自己会写的内容)。
// name = "cc-router" 后面紧跟引号, 不会误匹配 name = "cc-router-tui"。
function updateCargoLock(relPath, pkg) {
  const full = resolve(root, relPath);
  if (!existsSync(full)) {
    console.log(`  ${relPath}  (不存在, 跳过 — 首次 cargo build 会生成)`);
    return;
  }
  const original = readFileSync(full, "utf8");
  let replaced = false;
  const pattern = new RegExp(`(name = "${pkg}"\\r?\\nversion = ")([^"]*)(")`);
  const updated = original.replace(pattern, (_, p, _old, q) => {
    replaced = true;
    return `${p}${version}${q}`;
  });
  if (!replaced) {
    throw new Error(`未在 ${relPath} 找到 ${pkg} 包的 version 字段`);
  }
  writeFileSync(full, updated);
  console.log(`  ${relPath}  →  ${version}`);
}

console.log(`同步版本号到 ${version}：`);
updateJson("package.json");
updateJson("src-tauri/tauri.conf.json");
updateCargoToml("src-tauri/Cargo.toml");
updateCargoToml("src-tauri/crates/cc-router-tui/Cargo.toml");
updateCargoLock("src-tauri/Cargo.lock", "cc-router");
updateCargoLock("src-tauri/Cargo.lock", "cc-router-tui");
scaffoldReleaseNotes();
console.log("完成。建议接下来：");
console.log(`  编辑 release-notes/${version}/zh.md (zh-Hant.md / en.md / ja.md 可选)`);
console.log(`  git add -u && git add release-notes/${version}`);
console.log(`  git commit -m "Bump version to ${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push && git push --tags`);

// 发版说明骨架: 只在目录不存在时生成; 只写 zh.md, 不生成其他语言的空文件
// (空文件会被当成「已翻译」)。骨架只有分节标题, 会被 release-body --check (CI 第一个 job) 拒绝;
// 其余格式错误 (如空分节) 由 build.rs 用 app 同一个解析器在 release 构建时报错。
function scaffoldReleaseNotes() {
  const dir = resolve(root, "release-notes", version);
  if (existsSync(dir)) {
    console.log(`  release-notes/${version}/  (已存在, 不动)`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  writeFileSync(resolve(dir, "meta.json"), JSON.stringify({ date }, null, 2) + "\n");
  writeFileSync(resolve(dir, "zh.md"), "## 新功能\n\n## 修复\n\n## 其他\n");
  console.log(`  release-notes/${version}/  →  已生成 meta.json 与 zh.md 骨架, 发版前填好`);
}
