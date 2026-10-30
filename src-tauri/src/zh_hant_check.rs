//! 繁体中文的测试辅助 (只在 cfg(test) 下编译): 共享的系统语言用例表与简体残留检查。
//! 两份数据都在仓库根 `src/i18n/`, 前端 `scripts/check-i18n.mjs` 与 TUI 的测试读的是同一份文件。

use std::collections::HashSet;
use std::sync::OnceLock;

const LOCALE_CASES: &str = include_str!("../../src/i18n/locale-cases.json");
const SIMPLIFIED_ONLY: &str = include_str!("../../src/i18n/simplified-only.txt");

#[derive(serde::Deserialize)]
pub struct LocaleCase {
    pub tag: String,
    pub expect: String,
}

pub fn locale_cases() -> Vec<LocaleCase> {
    serde_json::from_str(LOCALE_CASES).expect("src/i18n/locale-cases.json 解析失败")
}

fn table() -> &'static HashSet<char> {
    static TABLE: OnceLock<HashSet<char>> = OnceLock::new();
    TABLE.get_or_init(|| {
        SIMPLIFIED_ONLY
            .lines()
            .filter(|l| !l.starts_with('#'))
            .flat_map(str::chars)
            .filter(|c| !c.is_whitespace())
            .collect()
    })
}

/// `text` 里出现的简体专用字, 按首次出现的顺序去重。
pub fn simplified_residue(text: &str) -> Vec<char> {
    let mut found = Vec::new();
    for c in text.chars() {
        if table().contains(&c) && !found.contains(&c) {
            found.push(c);
        }
    }
    found
}

/// `src` 里从 `pub const <name>: ` 起到下一个列首 `};` 为止的整块, 去掉 `//` 注释行。
/// 托盘与 TUI 的文案常量都是这个形状, 用它扫描繁中常量里的全部字面量 (含 `fn` 指针里的)。
pub fn const_block(src: &str, name: &str) -> String {
    let start = src.find(&format!("pub const {name}: ")).unwrap_or_else(|| panic!("找不到 pub const {name}"));
    let rest = &src[start..];
    let end = rest.find("\n};").unwrap_or_else(|| panic!("const {name} 没有以列首 `}};` 结束"));
    rest[..end].lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
}

#[test]
fn residue_flags_simplified_but_not_shared_forms() {
    assert_eq!(simplified_residue("这些设置"), vec!['这', '设']);
    // 简繁同形 / 多义字的正确繁体不能被误报
    assert!(simplified_residue("月之暗面 皇后 台灣 這裡 只有 干擾").is_empty());
}

#[test]
fn const_block_stops_at_the_first_column_zero_close() {
    let src = "pub const A: S = S {\n    a: \"x\", // 注释里的这\n    // 整行注释这\n};\npub const B: S = S {\n    a: \"这\",\n};\n";
    let block = const_block(src, "A");
    assert!(block.contains("\"x\""));
    assert!(!block.contains("整行注释"));
    assert!(!block.contains("pub const B"));
}
