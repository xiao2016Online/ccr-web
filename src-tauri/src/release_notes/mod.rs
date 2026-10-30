//! 「更新内容」弹窗的数据 (spec: docs/superpowers/specs/2026-09-27-release-notes-popup-design.md)。
//!
//! 内容来自编译期内嵌的 `release-notes/<版本>/` (build.rs::embed_release_notes);
//! 「未读」由 settings.last_seen_release_notes 与当前版本算出 (compute_unseen)。
pub mod markdown;

use std::collections::BTreeMap;
use std::sync::OnceLock;

use semver::Version;
use serde::{Deserialize, Serialize};

use markdown::NotesDoc;

// build.rs 生成: `pub static EMBEDDED_RELEASE_NOTES: &[(版本目录名, 文件名, 内容)]`。
include!(concat!(env!("OUT_DIR"), "/embedded_release_notes.rs"));

/// 允许的说明语言; 文件名为 `<lang>.md`
pub const LANGS: [&str; 4] = ["zh", "zh-Hant", "en", "ja"];

#[derive(Debug, Clone, Serialize)]
pub struct VersionNotes {
    pub version: String,
    pub date: Option<String>,
    pub codename: Option<String>,
    /// 键 "zh" / "zh-Hant" / "en" / "ja"; zh 必有
    pub notes: BTreeMap<String, NotesDoc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReleaseNotesDto {
    pub current: String,
    /// 该自动弹出的版本, 倒序; 空 = 不弹
    pub unseen: Vec<String>,
    /// 全部内嵌版本, 倒序
    pub versions: Vec<VersionNotes>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Meta {
    date: Option<String>,
    codename: Option<String>,
}

/// 把 (目录名, 文件名, 内容) 表组装成按版本倒序的列表。有问题的版本整条跳过, 原因记进 errors
/// (运行时只 warn, 单测要求 errors 为空)。
pub fn build(table: &[(&str, &str, &str)]) -> (Vec<VersionNotes>, Vec<String>) {
    let mut by_ver: BTreeMap<Version, (String, Vec<(&str, &str)>)> = BTreeMap::new();
    let mut errors = Vec::new();
    // `&(..)` 解构成 &str, 否则拿到的是 &&str, 推进 Vec<(&str, &str)> 会类型不符
    for &(dir, file, raw) in table {
        match Version::parse(dir) {
            Ok(v) => by_ver
                .entry(v)
                .or_insert_with(|| (dir.to_string(), Vec::new()))
                .1
                .push((file, raw)),
            Err(e) => errors.push(format!("{dir}: 目录名不是合法版本号 ({e})")),
        }
    }
    let mut out = Vec::new();
    for (_, (dir, files)) in by_ver.into_iter().rev() {
        match build_one(&dir, &files) {
            Ok(v) => out.push(v),
            Err(e) => errors.push(format!("{dir}/{e}")),
        }
    }
    (out, errors)
}

fn build_one(dir: &str, files: &[(&str, &str)]) -> Result<VersionNotes, String> {
    let mut notes = BTreeMap::new();
    let mut meta = Meta { date: None, codename: None };
    for (file, raw) in files {
        if *file == "meta.json" {
            meta = serde_json::from_str(raw).map_err(|e| format!("meta.json: {e}"))?;
            continue;
        }
        let lang = file
            .strip_suffix(".md")
            .filter(|l| LANGS.contains(l))
            .ok_or_else(|| format!("{file}: 只允许 meta.json / zh.md / zh-Hant.md / en.md / ja.md"))?;
        let doc = markdown::parse(raw).map_err(|e| format!("{file}: {e}"))?;
        notes.insert(lang.to_string(), doc);
    }
    if !notes.contains_key("zh") {
        return Err("缺少 zh.md".into());
    }
    if let Some(d) = &meta.date {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map_err(|_| format!("meta.json: date 应为 YYYY-MM-DD, 实际是 {d}"))?;
    }
    Ok(VersionNotes { version: dir.to_string(), date: meta.date, codename: meta.codename, notes })
}

/// 内嵌的全部版本, 倒序; 进程内只组装一次。
pub fn all() -> &'static [VersionNotes] {
    static CELL: OnceLock<Vec<VersionNotes>> = OnceLock::new();
    CELL.get_or_init(|| {
        let (out, errors) = build(EMBEDDED_RELEASE_NOTES);
        for e in errors {
            tracing::warn!(error = %e, "跳过无法解析的发版说明");
        }
        out
    })
}

/// 该自动弹出的版本 (倒序), 规则见 spec §4.4:
/// None → 只给当前版本; Some(s) → 区间 (s, current] 内有说明的版本; 已看过 / 降级 → 空。
/// 非法的 last_seen 按 None 处理; 非法的 current 什么都不给。
pub fn compute_unseen(last_seen: Option<&str>, current: &str, versions: &[VersionNotes]) -> Vec<String> {
    let Ok(cur) = Version::parse(current) else {
        return Vec::new();
    };
    let seen = last_seen.and_then(|s| Version::parse(s).ok());
    versions
        .iter()
        .filter(|v| {
            let Ok(ver) = Version::parse(&v.version) else {
                return false;
            };
            match &seen {
                None => ver == cur,
                Some(s) => ver > *s && ver <= cur,
            }
        })
        .map(|v| v.version.clone())
        .collect()
}

pub fn dto(last_seen: Option<&str>) -> ReleaseNotesDto {
    dto_from(last_seen, env!("CARGO_PKG_VERSION"), all())
}

/// 当前是正式版时, 预发布版本的说明对用户隐藏 (unseen 与 versions 都不含);
/// 当前本身是预发布 (测试用户) 时全部保留。
fn dto_from(last_seen: Option<&str>, current: &str, versions: &[VersionNotes]) -> ReleaseNotesDto {
    let stable = Version::parse(current).is_ok_and(|v| v.pre.is_empty());
    let visible: Vec<VersionNotes> = versions
        .iter()
        .filter(|v| !stable || Version::parse(&v.version).is_ok_and(|ver| ver.pre.is_empty()))
        .cloned()
        .collect();
    ReleaseNotesDto {
        current: current.to_string(),
        unseen: compute_unseen(last_seen, current, &visible),
        versions: visible,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZH: &str = "## 新功能\n- 一条\n";

    fn versions(list: &[&str]) -> Vec<VersionNotes> {
        let table: Vec<(&str, &str, &str)> = list.iter().map(|v| (*v, "zh.md", ZH)).collect();
        let (out, errors) = build(&table);
        assert!(errors.is_empty(), "{errors:#?}");
        out
    }

    fn unseen(last: Option<&str>, current: &str, list: &[&str]) -> Vec<String> {
        compute_unseen(last, current, &versions(list))
    }

    #[test]
    fn build_sorts_newest_first_and_reads_meta_and_optional_langs() {
        let table = [
            ("5.0.0", "zh.md", ZH),
            ("6.0.0", "en.md", "## Features\n- one\n"),
            ("6.0.0", "meta.json", r#"{"date":"2026-09-26","codename":"Sketchbook"}"#),
            ("6.0.0", "zh.md", ZH),
            ("6.1.0-beta.1", "zh.md", ZH),
        ];
        let (out, errors) = build(&table);
        assert!(errors.is_empty(), "{errors:#?}");
        let names: Vec<_> = out.iter().map(|v| v.version.as_str()).collect();
        assert_eq!(names, ["6.1.0-beta.1", "6.0.0", "5.0.0"]);
        let v6 = &out[1];
        assert_eq!(v6.date.as_deref(), Some("2026-09-26"));
        assert_eq!(v6.codename.as_deref(), Some("Sketchbook"));
        assert_eq!(v6.notes.keys().collect::<Vec<_>>(), ["en", "zh"]);
        assert!(out[2].date.is_none() && out[2].codename.is_none());
    }

    #[test]
    fn build_skips_broken_versions_and_reports_why() {
        let table = [
            ("not-a-version", "zh.md", ZH),
            ("6.0.0", "en.md", "## A\n- one\n"),                  // 缺 zh.md
            ("6.1.0", "zh.md", ZH),
            ("6.1.0", "fr.md", ZH),                               // 不认识的文件
            ("6.2.0", "zh.md", "### 三级\n"),                      // 解析失败
            ("6.3.0", "zh.md", ZH),
            ("6.3.0", "meta.json", r#"{"date":"26/09/2026"}"#),   // 日期格式错
            ("6.4.0", "zh.md", ZH),
            ("6.4.0", "meta.json", r#"{"title":"x"}"#),           // 不认识的键
            ("7.0.0", "zh.md", ZH),
        ];
        let (out, errors) = build(&table);
        assert_eq!(out.iter().map(|v| v.version.as_str()).collect::<Vec<_>>(), ["7.0.0"]);
        assert_eq!(errors.len(), 6, "{errors:#?}");
        assert!(errors.iter().any(|e| e.starts_with("not-a-version")));
        assert!(errors.iter().any(|e| e.contains("6.2.0/zh.md") && e.contains("第 1 行")));
    }

    #[test]
    fn unseen_rules() {
        let list = ["6.2.0", "6.0.0", "5.0.0", "4.8.0"]; // 6.1.0 没写说明
        // 老版本升上来 (None): 只给当前版本
        assert_eq!(unseen(None, "6.0.0", &list), ["6.0.0"]);
        // 当前版本没有说明文件
        assert!(unseen(None, "6.1.0", &list).is_empty());
        // 跨多个版本, 区间 (last, current], 有空洞时跳过
        assert_eq!(unseen(Some("4.8.0"), "6.2.0", &list), ["6.2.0", "6.0.0", "5.0.0"]);
        assert_eq!(unseen(Some("6.0.0"), "6.1.0", &list), Vec::<String>::new());
        // 已看过 / 降级
        assert!(unseen(Some("6.2.0"), "6.2.0", &list).is_empty());
        assert!(unseen(Some("6.2.0"), "6.0.0", &list).is_empty());
        // 非法的 last_seen 按 None 处理
        assert_eq!(unseen(Some("garbage"), "6.0.0", &list), ["6.0.0"]);
        // 非法的 current: 什么都不弹
        assert!(unseen(None, "dev", &list).is_empty());
    }

    #[test]
    fn unseen_orders_prerelease_before_release() {
        // 当前版本本身是预发布: 预发布说明全部保留, 按 semver 倒序
        let list = ["6.1.0-beta.2", "6.1.0-beta.1", "6.0.0"];
        let dto = dto_from(Some("6.0.0"), "6.1.0-beta.2", &versions(&list));
        assert_eq!(dto.unseen, ["6.1.0-beta.2", "6.1.0-beta.1"]);
        assert_eq!(unseen(Some("6.0.0"), "6.1.0-beta.1", &list), ["6.1.0-beta.1"]);
    }

    #[test]
    fn stable_current_hides_prerelease_notes() {
        let list = ["6.1.0", "6.1.0-beta.1", "6.0.0"];
        let dto = dto_from(Some("6.0.0"), "6.1.0", &versions(&list));
        assert_eq!(dto.unseen, ["6.1.0"]);
        let names: Vec<_> = dto.versions.iter().map(|v| v.version.as_str()).collect();
        assert_eq!(names, ["6.1.0", "6.0.0"]);
    }

    /// 仓库里真实的 release-notes/ 必须全部合法; 写错格式在 cargo test 阶段就拦住。
    #[test]
    fn build_accepts_zh_hant_notes() {
        let (v, errors) = build(&[
            ("6.5.0", "zh.md", "## 新功能\n- 一条\n"),
            ("6.5.0", "zh-Hant.md", "## 新功能\n- 一條\n"),
        ]);
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(v[0].notes.keys().collect::<Vec<_>>(), ["zh", "zh-Hant"]);
    }

    #[test]
    fn every_embedded_release_note_is_valid() {
        let (out, errors) = build(EMBEDDED_RELEASE_NOTES);
        assert!(errors.is_empty(), "release-notes/ 有不合法的文件:\n{errors:#?}");
        let dirs: std::collections::BTreeSet<_> = EMBEDDED_RELEASE_NOTES.iter().map(|(d, _, _)| *d).collect();
        assert_eq!(out.len(), dirs.len());
    }
}
