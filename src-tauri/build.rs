use std::fmt::Write as _;
use std::path::Path;

// 与 app 共用同一个发版说明解析器, 构建时就能拦住格式错误 (见 embed_release_notes)。
#[path = "src/release_notes/markdown.rs"]
#[allow(dead_code)]
mod release_notes_markdown;

fn main() {
    embed_providers();
    embed_release_notes();
    ensure_sidecar_placeholder();
    ensure_ui_dist_placeholder();
    // server 构建 (--no-default-features) 不跑 tauri-build: 它只为桌面形态生成上下文代码。
    if std::env::var_os("CARGO_FEATURE_DESKTOP").is_some() {
        tauri_build::build()
    }
}

/// 服务器形态用 rust-embed 内嵌 `ui-dist/` (Docker 构建时由前端阶段拷入)。
/// 这里保证本地直接 cargo check 时目录存在, 不让 rust-embed 因缺目录而编译失败。
fn ensure_ui_dist_placeholder() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let dir = Path::new(&manifest_dir).join("ui-dist");
    let index = dir.join("index.html");
    if !index.exists() {
        std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("创建 {} 失败: {e}", dir.display()));
        std::fs::write(&index, b"<!doctype html><title>cc-router</title><p>ui-dist placeholder: run `pnpm build` and copy dist/ here.").unwrap_or_else(|e| panic!("写入 {} 失败: {e}", index.display()));
    }
    println!("cargo:rerun-if-changed={}", dir.display());
}

/// tauri-build 在**每次** cargo 构建 (含 check / test) 时都会复制 `bundle.externalBin` 指向的文件,
/// 不存在就直接失败。真正的 sidecar 由 `scripts/build-tui-sidecar.mjs` 在 tauri dev / build 的钩子里生成;
/// 这里只保证「没跑过钩子」的场景 (新克隆后直接 cargo test) 也能编过: 缺文件时放一个 0 字节占位。
/// 占位永远不会覆盖真文件, `commands::tui` 把 0 字节文件视为「未包含 TUI」。
fn ensure_sidecar_placeholder() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let target = std::env::var("TARGET").expect("TARGET");
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let dir = Path::new(&manifest_dir).join("binaries");
    let file = dir.join(format!("cc-router-tui-{target}{ext}"));
    if !file.exists() {
        std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("创建 {} 失败: {e}", dir.display()));
        std::fs::write(&file, b"").unwrap_or_else(|e| panic!("写入 {} 失败: {e}", file.display()));
    }
}

/// 把 `providers/*.yaml` 编进二进制: 生成 `$OUT_DIR/embedded_providers.rs`, 内容是一张
/// `(文件名, include_str!(绝对路径))` 表, 由 `provider::loader` 用 `include!` 引入。
///
/// 目录扫描放在 build.rs 而不是手写 `include_str!` 列表, 是为了「加 provider 只需要丢一个 yaml」——
/// 以前漏登记 `tauri.conf.json::bundle.resources` 会导致 release 包启动即 fatal。
fn embed_providers() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let dir = Path::new(&manifest_dir).join("providers");
    // 对目录声明: cargo 递归比较 mtime, 新增 / 删除 / 修改 yaml 都会重跑本脚本。
    println!("cargo:rerun-if-changed={}", dir.display());

    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("读取 {} 失败: {e}", dir.display()))
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| matches!(p.extension().and_then(|x| x.to_str()), Some("yaml" | "yml")))
        .collect();
    // read_dir 顺序依赖文件系统; 排序保证生成结果 (进而二进制) 可复现。
    files.sort();
    assert!(!files.is_empty(), "{} 下没有任何 provider yaml", dir.display());

    let mut out = String::from("pub static EMBEDDED_PROVIDERS: &[(&str, &str)] = &[\n");
    for path in &files {
        let name = path.file_name().and_then(|n| n.to_str()).expect("yaml 文件名非 UTF-8");
        // {:?} 负责转义: Windows 路径里的反斜杠必须变成合法的 Rust 字符串字面量。
        writeln!(out, "    ({name:?}, include_str!({:?})),", path.display().to_string()).unwrap();
    }
    out.push_str("];\n");

    let dest = Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("embedded_providers.rs");
    std::fs::write(&dest, out).unwrap_or_else(|e| panic!("写入 {} 失败: {e}", dest.display()));
}

/// 把仓库根目录的 `release-notes/<版本>/*` 编进二进制: 生成 `$OUT_DIR/embedded_release_notes.rs`,
/// 内容是 `(版本目录名, 文件名, include_str!(绝对路径))` 表, 由 `release_notes` 模块 `include!`。
/// 目录不存在时生成空表 (不 panic)。每个 `*.md` 都用 app 同一个解析器校验、每个版本目录必须有 zh.md:
/// release 构建有错直接 panic (发版 job 在 publish 之前失败, 不会发出一个弹不出说明的版本);
/// dev / test 构建只出 cargo warning, 边写说明边开发不受影响 (单测 every_embedded_release_note_is_valid 仍会失败)。
fn embed_release_notes() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let dir = Path::new(&manifest_dir)
        .parent()
        .expect("src-tauri 应有上级目录")
        .join("release-notes");
    // 对目录声明: cargo 递归比较 mtime, 新增 / 删除 / 修改说明文件都会重跑本脚本。
    println!("cargo:rerun-if-changed={}", dir.display());

    let mut entries: Vec<(String, String, std::path::PathBuf)> = Vec::new();
    if dir.is_dir() {
        for ver in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("读取 {} 失败: {e}", dir.display())) {
            let ver = ver.expect("读取目录项失败").path();
            if !ver.is_dir() {
                continue;
            }
            let ver_name = ver.file_name().and_then(|n| n.to_str()).expect("版本目录名非 UTF-8").to_string();
            for file in std::fs::read_dir(&ver).unwrap_or_else(|e| panic!("读取 {} 失败: {e}", ver.display())) {
                let path = file.expect("读取目录项失败").path();
                let name = path.file_name().and_then(|n| n.to_str()).expect("文件名非 UTF-8").to_string();
                // .DS_Store 之类的隐藏文件不收
                if !path.is_file() || name.starts_with('.') {
                    continue;
                }
                entries.push((ver_name.clone(), name, path));
            }
        }
    }
    // read_dir 顺序依赖文件系统; 排序保证生成结果 (进而二进制) 可复现。
    entries.sort();

    let mut errors = Vec::new();
    let versions: std::collections::BTreeSet<&str> = entries.iter().map(|(v, _, _)| v.as_str()).collect();
    for ver in versions {
        if !entries.iter().any(|(v, n, _)| v == ver && n == "zh.md") {
            errors.push(format!("release-notes/{ver}: 缺少 zh.md"));
        }
    }
    for (ver, name, path) in entries.iter().filter(|(_, n, _)| n.ends_with(".md")) {
        let src = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("读取 {} 失败: {e}", path.display()));
        if let Err(e) = release_notes_markdown::parse(&src) {
            errors.push(format!("release-notes/{ver}/{name}: {e}"));
        }
    }
    if !errors.is_empty() {
        if std::env::var("PROFILE").as_deref() == Ok("release") {
            panic!("release-notes/ 有不合法的发版说明:\n{}", errors.join("\n"));
        }
        for e in &errors {
            println!("cargo:warning={e}");
        }
    }

    let mut out = String::from("pub static EMBEDDED_RELEASE_NOTES: &[(&str, &str, &str)] = &[\n");
    for (ver, name, path) in &entries {
        writeln!(out, "    ({ver:?}, {name:?}, include_str!({:?})),", path.display().to_string()).unwrap();
    }
    out.push_str("];\n");

    let dest = Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("embedded_release_notes.rs");
    std::fs::write(&dest, out).unwrap_or_else(|e| panic!("写入 {} 失败: {e}", dest.display()));
}
