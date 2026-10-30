//! 托盘菜单的语言与文案。
//!
//! 刻意不引 Rust i18n 框架: 文案是 `TrayStrings` 的四个 `const`, 漏字段即编译失败,
//! 带参数的文案用 `fn` 指针 (与 cc-router-tui 的 `Strings` 同一做法)。

/// 托盘菜单语言，与前端 `src/i18n/index.tsx` 的 `Locale` 一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayLocale {
    Zh,
    ZhHant,
    En,
    Ja,
}

impl TrayLocale {
    /// `settings.preferred_language`（"system" / "zh" / "zh-Hant" / "en" / "ja"）→ 实际语言。
    pub fn from_pref(pref: &str) -> Self {
        Self::resolve(pref, tauri_plugin_os::locale().as_deref())
    }

    /// `from_pref` 的纯函数版本：系统语言标签显式传入而不是直接读 OS，
    /// 这样映射规则在任何平台的 CI 上都能单测。
    fn resolve(pref: &str, system_tag: Option<&str>) -> Self {
        match pref {
            "zh" => Self::Zh,
            "zh-Hant" => Self::ZhHant,
            "en" => Self::En,
            "ja" => Self::Ja,
            // "system"、空串、以及任何未知值都走系统探测 —— 前端 resolvePref 同样如此。
            _ => system_tag.map_or(Self::En, Self::from_tag),
        }
    }

    /// 系统语言标签 → 语言。与前端 `src/i18n/localeTag.ts::localeFromTag`、TUI `Lang::from_tag`
    /// 是同一条规则, 由仓库根 `src/i18n/locale-cases.json` 锁住 —— 改规则先改用例表。
    /// 小写、`_`→`-`、截掉 `.编码` / `@修饰` 后按子标签判定; 书写系统 (hant / hans) 优先于地区。
    fn from_tag(tag: &str) -> Self {
        let lower = tag.trim().to_ascii_lowercase().replace('_', "-");
        let norm = lower.split(['.', '@']).next().unwrap_or("");
        let parts: Vec<&str> = norm.split('-').filter(|p| !p.is_empty()).collect();
        match parts.first().copied() {
            // 粤语 (`yue`, macOS 的「粵語（繁體）」) 同样判定, 什么都不带时默认繁中。
            Some(lang @ ("zh" | "yue")) => {
                if parts.contains(&"hant") {
                    Self::ZhHant
                } else if parts.contains(&"hans") {
                    Self::Zh
                } else if parts.iter().any(|p| matches!(*p, "tw" | "hk" | "mo")) || lang == "yue" {
                    Self::ZhHant
                } else {
                    Self::Zh
                }
            }
            Some("ja") => Self::Ja,
            _ => Self::En,
        }
    }

    pub fn strings(self) -> &'static TrayStrings {
        match self {
            Self::Zh => &ZH,
            Self::ZhHant => &ZH_HANT,
            Self::En => &EN,
            Self::Ja => &JA,
        }
    }
}

pub struct TrayStrings {
    /// 代理还没绑定端口时的状态行 (启动后几百毫秒内)
    pub status_starting: &'static str,
    pub status_running: fn(addr: &str) -> String,
    pub status_stopped: &'static str,
    pub subs_none: &'static str,
    pub subs_all_disabled: &'static str,
    pub subs_ok: fn(enabled: usize) -> String,
    pub subs_some_down: fn(enabled: usize, down: usize) -> String,
    pub show_window: &'static str,
    pub open_live: &'static str,
    pub open_logs: &'static str,
    pub copy_env: &'static str,
    /// 复制成功后「复制」那一项临时换成这句, 几秒后复原
    pub copied: &'static str,
    pub check_update: &'static str,
    pub update_available: fn(version: &str) -> String,
    pub autostart: &'static str,
    pub quit: &'static str,
    pub tooltip: fn(running: bool, down: usize, has_update: bool) -> String,
}

pub const ZH: TrayStrings = TrayStrings {
    status_starting: "代理启动中…",
    status_running: |addr| format!("● 代理运行中 · {addr}"),
    status_stopped: "○ 代理未运行",
    subs_none: "还没有订阅",
    subs_all_disabled: "订阅全部已停用",
    subs_ok: |n| format!("{n} 个订阅 · 全部可用"),
    subs_some_down: |n, down| format!("{n} 个订阅 · {down} 个不可用"),
    show_window: "显示主窗口",
    open_live: "实时路由",
    open_logs: "请求日志",
    copy_env: "复制 Claude Code 环境变量",
    copied: "✓ 已复制到剪贴板",
    check_update: "检查更新…",
    update_available: |v| format!("⬆ 有新版本 v{v} · 查看"),
    autostart: "开机自动启动",
    quit: "退出 cc-router",
    tooltip: |running, down, has_update| {
        let mut s = String::from(if running { "cc-router · 运行中" } else { "cc-router · 代理未运行" });
        if down > 0 {
            s.push_str(&format!(" · {down} 个订阅不可用"));
        }
        if has_update {
            s.push_str(" · 有新版本");
        }
        s
    },
};

pub const ZH_HANT: TrayStrings = TrayStrings {
    status_starting: "代理啟動中…",
    status_running: |addr| format!("● 代理執行中 · {addr}"),
    status_stopped: "○ 代理未執行",
    subs_none: "還沒有訂閱",
    subs_all_disabled: "訂閱已全部停用",
    subs_ok: |n| format!("{n} 個訂閱 · 全部可用"),
    subs_some_down: |n, down| format!("{n} 個訂閱 · {down} 個無法使用"),
    show_window: "顯示主視窗",
    open_live: "即時路由",
    open_logs: "請求紀錄",
    copy_env: "複製 Claude Code 環境變數",
    copied: "✓ 已複製到剪貼簿",
    check_update: "檢查更新…",
    update_available: |v| format!("⬆ 有新版本 v{v} · 查看"),
    autostart: "開機時自動啟動",
    quit: "結束 cc-router",
    tooltip: |running, down, has_update| {
        let mut s = String::from(if running { "cc-router · 執行中" } else { "cc-router · 代理未執行" });
        if down > 0 {
            s.push_str(&format!(" · {down} 個訂閱無法使用"));
        }
        if has_update {
            s.push_str(" · 有新版本");
        }
        s
    },
};

pub const EN: TrayStrings = TrayStrings {
    status_starting: "Proxy starting…",
    status_running: |addr| format!("● Proxy running · {addr}"),
    status_stopped: "○ Proxy not running",
    subs_none: "No subscriptions yet",
    subs_all_disabled: "All subscriptions disabled",
    subs_ok: |n| {
        if n == 1 {
            "1 subscription · available".to_string()
        } else {
            format!("{n} subscriptions · all available")
        }
    },
    subs_some_down: |n, down| {
        let noun = if n == 1 { "subscription" } else { "subscriptions" };
        format!("{n} {noun} · {down} unavailable")
    },
    show_window: "Show Main Window",
    open_live: "Live Routing",
    open_logs: "Request Logs",
    copy_env: "Copy Claude Code Env Vars",
    copied: "✓ Copied to Clipboard",
    check_update: "Check for Updates…",
    update_available: |v| format!("⬆ Update Available: v{v}"),
    autostart: "Launch at Startup",
    quit: "Quit cc-router",
    tooltip: |running, down, has_update| {
        let mut s = String::from(if running { "cc-router · running" } else { "cc-router · proxy not running" });
        if down > 0 {
            let noun = if down == 1 { "subscription" } else { "subscriptions" };
            s.push_str(&format!(" · {down} {noun} unavailable"));
        }
        if has_update {
            s.push_str(" · update available");
        }
        s
    },
};

pub const JA: TrayStrings = TrayStrings {
    status_starting: "プロキシ起動中…",
    status_running: |addr| format!("● プロキシ稼働中 · {addr}"),
    status_stopped: "○ プロキシ停止中",
    subs_none: "サブスクリプションなし",
    subs_all_disabled: "サブスクリプションはすべて無効",
    subs_ok: |n| format!("サブスクリプション {n} 件 · すべて利用可能"),
    subs_some_down: |n, down| format!("サブスクリプション {n} 件 · {down} 件が利用不可"),
    show_window: "メインウィンドウを表示",
    open_live: "リアルタイムルーティング",
    open_logs: "リクエストログ",
    copy_env: "Claude Code の環境変数をコピー",
    copied: "✓ クリップボードにコピーしました",
    check_update: "更新を確認…",
    update_available: |v| format!("⬆ 新しいバージョン v{v} · 確認する"),
    autostart: "起動時に自動実行",
    quit: "cc-router を終了",
    tooltip: |running, down, has_update| {
        let mut s = String::from(if running { "cc-router · 稼働中" } else { "cc-router · プロキシ停止中" });
        if down > 0 {
            s.push_str(&format!(" · サブスクリプション {down} 件が利用不可"));
        }
        if has_update {
            s.push_str(" · 新しいバージョンあり");
        }
        s
    },
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_pref_overrides_system_locale() {
        assert_eq!(TrayLocale::resolve("zh", Some("en-US")), TrayLocale::Zh);
        assert_eq!(TrayLocale::resolve("en", Some("zh-Hans-CN")), TrayLocale::En);
        assert_eq!(TrayLocale::resolve("ja", Some("zh-CN")), TrayLocale::Ja);
        // 显式选择时根本不该看系统 locale, 取不到也无所谓
        assert_eq!(TrayLocale::resolve("ja", None), TrayLocale::Ja);
        assert_eq!(TrayLocale::resolve("zh-Hant", Some("en-US")), TrayLocale::ZhHant);
        assert_eq!(TrayLocale::resolve("zh", Some("zh-TW")), TrayLocale::Zh);
    }

    #[test]
    fn unknown_or_missing_falls_back_to_english() {
        assert_eq!(TrayLocale::resolve("system", None), TrayLocale::En);
        assert_eq!(TrayLocale::resolve("", None), TrayLocale::En);
        // 手改 settings.json 塞了非法值, 不能 panic, 走系统探测
        assert_eq!(TrayLocale::resolve("klingon", Some("zh-CN")), TrayLocale::Zh);
        assert_eq!(TrayLocale::resolve("klingon", None), TrayLocale::En);
        assert_eq!(TrayLocale::resolve("fr", Some("zh-HK")), TrayLocale::ZhHant);
    }

    /// 与前端 `src/i18n/localeTag.ts::localeFromTag`、TUI `Lang::from_tag` 的契约: 三处读同一张用例表。
    #[test]
    fn system_tags_follow_the_shared_rule() {
        for c in crate::zh_hant_check::locale_cases() {
            let want = match c.expect.as_str() {
                "zh" => TrayLocale::Zh,
                "zh-Hant" => TrayLocale::ZhHant,
                "en" => TrayLocale::En,
                "ja" => TrayLocale::Ja,
                other => panic!("locale-cases.json 里有未知语言 {other}"),
            };
            assert_eq!(TrayLocale::from_tag(&c.tag), want, "tag {:?}", c.tag);
            assert_eq!(TrayLocale::resolve("system", Some(&c.tag)), want, "tag {:?}", c.tag);
        }
    }

    #[test]
    fn zh_hant_has_no_simplified_residue() {
        let block = crate::zh_hant_check::const_block(include_str!("strings.rs"), "ZH_HANT");
        let residue = crate::zh_hant_check::simplified_residue(&block);
        assert!(residue.is_empty(), "ZH_HANT 里有简体字: {residue:?}");
    }

    #[test]
    fn zh_hant_tooltip_mentions_only_what_is_wrong() {
        let t = ZH_HANT.tooltip;
        assert_eq!(t(true, 0, false), "cc-router · 執行中");
        assert_eq!(t(true, 2, false), "cc-router · 執行中 · 2 個訂閱無法使用");
        assert_eq!(t(false, 0, true), "cc-router · 代理未執行 · 有新版本");
    }

    /// 加语言 / 改文案时填了空串 -> 空白菜单项, 这里兜住。
    #[test]
    fn every_locale_has_non_empty_labels() {
        for locale in [TrayLocale::Zh, TrayLocale::ZhHant, TrayLocale::En, TrayLocale::Ja] {
            let s = locale.strings();
            let fixed = [
                s.status_starting,
                s.status_stopped,
                s.subs_none,
                s.subs_all_disabled,
                s.show_window,
                s.open_live,
                s.open_logs,
                s.copy_env,
                s.copied,
                s.check_update,
                s.autostart,
                s.quit,
            ];
            for text in fixed {
                assert!(!text.trim().is_empty(), "{locale:?} 有空文案");
            }
            assert!((s.status_running)("127.0.0.1:23456").contains("127.0.0.1:23456"));
            assert!((s.subs_ok)(6).contains('6'));
            let down = (s.subs_some_down)(6, 2);
            assert!(down.contains('6') && down.contains('2'), "{locale:?}: {down}");
            assert!((s.update_available)("6.1.0").contains("6.1.0"));
        }
    }

    #[test]
    fn english_counts_are_singular_for_one() {
        assert_eq!((EN.subs_ok)(1), "1 subscription · available");
        assert_eq!((EN.subs_ok)(3), "3 subscriptions · all available");
        assert_eq!((EN.subs_some_down)(1, 1), "1 subscription · 1 unavailable");
        assert_eq!((EN.tooltip)(true, 1, false), "cc-router · running · 1 subscription unavailable");
    }

    #[test]
    fn tooltip_mentions_only_what_is_wrong() {
        let t = ZH.tooltip;
        assert_eq!(t(true, 0, false), "cc-router · 运行中");
        assert_eq!(t(true, 2, false), "cc-router · 运行中 · 2 个订阅不可用");
        assert_eq!(t(false, 0, true), "cc-router · 代理未运行 · 有新版本");
    }
}
