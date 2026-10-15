use serde::Serialize;
use crate::state::State;

use crate::error::AppResult;
use crate::proxy::controller::RestartOutcome;
use crate::proxy::listeners::ProxyConfig;
use crate::proxy::server::AppHooks;
use crate::settings::model::ProxyMode;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ProxyStatus {
    /// 兼容老前端字段: HTTP 端口 (HTTPS-only 模式下回退到 HTTPS 端口, 保留单值入口).
    pub port: u16,
    pub running: bool,
    pub mode: ProxyMode,
    /// HTTP listener 实际绑定端口, None=HTTP 未启用 (HTTPS-only 模式).
    pub http_port: Option<u16>,
    /// HTTPS listener 实际绑定端口, None=HTTPS 未启用 (HTTP-only 模式).
    pub https_port: Option<u16>,
    /// true: 监听 0.0.0.0; false: 仅 127.0.0.1.
    pub listen_all: bool,
    /// 客户端工具应连接的完整 base URL (含 scheme + port). 由 [`AppState::local_base_url`] 决定.
    /// 前端硬拼 URL 容易在 HTTPS-only / 端口冲突 +1 时出错, 改由后端给定唯一真相.
    pub base_url: String,
    /// 代理在运行且当前设置与生效配置不同 (有需要「重启代理服务」才生效的改动).
    pub restart_pending: bool,
    /// 正在运行的实例的生效配置; None = 未运行. 与实际端口比较可知是否发生了顺延.
    pub applied: Option<ProxyConfig>,
    /// 最近一次启动 / 重启 / 运行中崩溃的原因.
    pub last_error: Option<String>,
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn proxy_status(state: State<'_, AppState>) -> AppResult<ProxyStatus> {
    Ok(status_of(&state).await)
}

async fn status_of(state: &AppState) -> ProxyStatus {
    let http_port = *state.http_bound_port.read().await;
    let https_port = *state.https_bound_port.read().await;
    let desired = ProxyConfig::from_settings(&*state.settings.read().await);
    let snap = state.proxy.snapshot();
    // 运行中报生效配置 (设置可能已改但未重启), 未运行时退回设置值.
    let shown = snap.applied.unwrap_or(desired);
    let primary = http_port.or(https_port).unwrap_or(0);
    ProxyStatus {
        port: primary,
        running: primary != 0,
        mode: shown.proxy_mode,
        http_port,
        https_port,
        listen_all: shown.listen_all,
        base_url: state.local_base_url().await,
        restart_pending: state.proxy.restart_pending(&desired),
        applied: snap.applied,
        last_error: snap.last_error,
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum RestartProxyResult {
    Applied { status: ProxyStatus },
    RolledBack { status: ProxyStatus, error: String },
    Stopped { status: ProxyStatus, error: String },
    Failed { status: ProxyStatus, error: String },
}

/// 按当前设置在进程内重建代理 listener. 网页界面也能调: 这个请求本身走的是旧 listener
/// 上已建立的连接, 属于在途请求, 优雅关停会等它的响应写完再关连接.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn restart_proxy(state: State<'_, AppState>) -> AppResult<RestartProxyResult> {
    let st = &*state;
    let outcome = st.proxy.restart(AppHooks(st.clone())).await;
    let status = status_of(st).await;
    Ok(match outcome {
        RestartOutcome::Applied => RestartProxyResult::Applied { status },
        RestartOutcome::RolledBack(error) => RestartProxyResult::RolledBack { status, error },
        RestartOutcome::Stopped(error) => RestartProxyResult::Stopped { status, error },
        RestartOutcome::Failed(error) => RestartProxyResult::Failed { status, error },
    })
}

/// Claude Code 接入 cc-router 的环境变量 (键, 值), 顺序即输出顺序。
/// 字段集与前端 `src/lib/recommendedClaudeCodeEnv.ts` 是同一份, 改一边要同步另一边。
/// `env_snippet` (接入指南) 与托盘「复制 Claude Code 环境变量」共用。
pub(crate) fn claude_code_env(base_url: &str, token: &str) -> Vec<(&'static str, String)> {
    let fixed: [(&'static str, &str); 11] = [
        ("API_TIMEOUT_MS", "3000000"),
        ("ANTHROPIC_MODEL", "model-opus"),
        ("ANTHROPIC_DEFAULT_FABLE_MODEL", "model-fable"),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", "model-opus"),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", "model-sonnet"),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "model-haiku"),
        ("CLAUDE_CODE_SUBAGENT_MODEL", "model-opus"),
        ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
        ("CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK", "1"),
        ("CLAUDE_CODE_ATTRIBUTION_HEADER", "0"),
        ("CLAUDE_CODE_EFFORT_LEVEL", "max"),
    ];
    let mut out = vec![
        ("ANTHROPIC_BASE_URL", base_url.to_string()),
        ("ANTHROPIC_AUTH_TOKEN", token.to_string()),
    ];
    out.extend(fixed.iter().map(|(k, v)| (*k, v.to_string())));
    out
}

/// POSIX shell 形态: `export K=V`, 值原样 (URL / token / 常量里都没有需要转义的字符)。
pub(crate) fn render_env_export(pairs: &[(&str, String)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("export {k}={v}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// PowerShell 形态: `$env:K = "V"`。双引号串里 `` ` `` / `"` / `$` 要用反引号转义。
/// (当前只被单元测试的转义用例引用)
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn render_env_powershell(pairs: &[(&str, String)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| {
            let escaped: String = v
                .chars()
                .flat_map(|c| match c {
                    '`' | '"' | '$' => vec!['`', c],
                    _ => vec![c],
                })
                .collect();
            format!("$env:{k} = \"{escaped}\"")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn env_snippet(state: State<'_, AppState>) -> AppResult<String> {
    let base_url = state.local_base_url().await;
    let token = state.settings.read().await.auth_token.clone();
    Ok(render_env_export(&claude_code_env(&base_url, &token)))
}

/// 网页界面设置页展示局域网访问地址用. 只列非回环 IPv4.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_lan_addresses() -> AppResult<Vec<String>> {
    let ifaces = if_addrs::get_if_addrs()
        .map_err(|e| crate::error::AppError::internal(format!("枚举网卡失败: {e}")))?;
    let mut out: Vec<String> = ifaces
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(v4) => Some(v4.to_string()),
            std::net::IpAddr::V6(_) => None,
        })
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 抽成 claude_code_env 之前 env_snippet 的原文, 锁住输出一个字符都不变。
    #[test]
    fn export_rendering_is_unchanged() {
        let got = render_env_export(&claude_code_env("http://127.0.0.1:23456", "tok"));
        assert_eq!(
            got,
            "export ANTHROPIC_BASE_URL=http://127.0.0.1:23456\n\
             export ANTHROPIC_AUTH_TOKEN=tok\n\
             export API_TIMEOUT_MS=3000000\n\
             export ANTHROPIC_MODEL=model-opus\n\
             export ANTHROPIC_DEFAULT_FABLE_MODEL=model-fable\n\
             export ANTHROPIC_DEFAULT_OPUS_MODEL=model-opus\n\
             export ANTHROPIC_DEFAULT_SONNET_MODEL=model-sonnet\n\
             export ANTHROPIC_DEFAULT_HAIKU_MODEL=model-haiku\n\
             export CLAUDE_CODE_SUBAGENT_MODEL=model-opus\n\
             export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\n\
             export CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK=1\n\
             export CLAUDE_CODE_ATTRIBUTION_HEADER=0\n\
             export CLAUDE_CODE_EFFORT_LEVEL=max"
        );
    }

    #[test]
    fn powershell_rendering_quotes_and_escapes() {
        let got = render_env_powershell(&[("A", "http://x:1".into()), ("B", "a$b\"c`d".into())]);
        assert_eq!(got, "$env:A = \"http://x:1\"\n$env:B = \"a`$b`\"c``d\"");
    }
}
