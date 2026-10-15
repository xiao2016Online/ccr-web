//! 服务器形态 (`--no-default-features --features server`) 的入口与启动序列。
//!
//! 与桌面形态的差异全部集中在这里:
//! - 数据目录: `CCR_DATA_DIR` (缺省 `./data`, 容器镜像指到 `/data`);
//! - 安全播种 (每次启动强制): 监听 0.0.0.0、Web UI 开启且强制登录、TUI/本机通行关闭;
//! - 管理员账号: `CCR_ADMIN_USER` / `CCR_ADMIN_PASSWORD` 播种, 未指定则生成随机密码
//!   打印到日志; `CCR_ADMIN_RESET=1` 可强制重置;
//! - 无托盘 / 自启动 / 应用内更新 / runtime.json (TUI 通道);
//! - 收到 SIGTERM / SIGINT 后直接退出, 优雅停机交给容器编排器。

use anyhow::Context;
use tracing::{error, info, warn};

use crate::settings::model::Settings;
use crate::state::AppState;

pub async fn run_server() -> anyhow::Result<()> {
    // 1. 数据目录 + 日志 (stdout + 滚动文件, 容器 logs 直接可读)
    let data_dir = crate::db::paths::app_data_dir()?;
    tokio::fs::create_dir_all(&data_dir)
        .await
        .with_context(|| format!("创建数据目录失败: {}", data_dir.display()))?;
    crate::observability::logger::init(&data_dir)?;
    info!(
        version = env!("CARGO_PKG_VERSION"),
        data_dir = %data_dir.display(),
        "cc-router server starting"
    );

    // 2. Settings + 服务器安全播种
    let settings_path = data_dir.join("settings.json");
    let first_run = !settings_path.exists();
    let mut settings = crate::settings::load_or_default(&data_dir).await?;
    seed_server_settings(&mut settings, first_run);
    crate::settings::ensure_auth_token(&data_dir, &mut settings).await?;
    crate::settings::save(&data_dir, &settings).await?;

    // 3. 启动序列 (与桌面共用): DB → providers → 订阅 → 代理 → 后台任务
    let state = crate::bootstrap_core(data_dir, None, settings)
        .await
        .context("bootstrap failed")?;

    // 4. 管理员账号播种 (需要 DB 迁移先跑完)
    let admin_username = match ensure_admin(&state).await {
        Ok(v) => v,
        Err(e) => {
            error!(?e, "管理员账号播种失败, 管理界面将无法登录");
            return Err(e);
        }
    };

    // 5. 接入信息横幅
    let settings = state.settings.read().await.clone();
    let host = if settings.listen_all { "0.0.0.0" } else { "127.0.0.1" };
    let port = state.http_bound_port.read().await.or(settings.proxy_port.into());
    info!(
        proxy = format!("http://{host}:{}/v1", port.unwrap_or(settings.proxy_port)),
        web_ui = format!("http://{host}:{}/ui/", port.unwrap_or(settings.proxy_port)),
        admin_user = %admin_username,
        "cc-router server ready"
    );

    // 6. 常驻直到收到停止信号
    wait_for_shutdown().await;
    info!("shutdown signal received, exiting");
    Ok(())
}

/// 服务器形态的设置播种。
///
/// 每次启动都强制的安全项 (UI 里改了也会被下一次启动改回 —— 这些项在容器里没有
/// 安全的替代值, 见 README-SERVER.md 的环境变量表):
/// - `listen_all`: 端口映射要求容器内绑 0.0.0.0;
/// - `web_ui_enabled` + `web_ui_auth_enabled`: 管理界面必须经登录访问
///   (容器的「本机回环」在容器网络里不等于管理员本人, 不能放行);
/// - `tui_enabled`: 关闭 cc-router-tui 的「本机通行」通道;
/// - `autostart`: 服务器没有 OS 登录项。
///
/// 仅首次启动播种一次的偏好项: 语言 (CCR_LANG, 缺省 zh)、端口 (CCR_PROXY_PORT)。
fn seed_server_settings(settings: &mut Settings, first_run: bool) {
    settings.listen_all = true;
    settings.web_ui_enabled = true;
    settings.web_ui_auth_enabled = true;
    settings.tui_enabled = false;
    settings.autostart = false;
    // 反向代理拓扑属于部署环境而非用户偏好: 每次启动都按环境变量对齐。
    settings.trust_proxy = std::env::var("CCR_TRUST_PROXY").is_ok();
    if first_run {
        if let Ok(lang) = std::env::var("CCR_LANG") {
            if !lang.trim().is_empty() {
                settings.preferred_language = lang.trim().to_string();
            }
        } else {
            settings.preferred_language = "zh".to_string();
        }
        if let Ok(port) = std::env::var("CCR_PROXY_PORT") {
            match port.trim().parse::<u16>() {
                Ok(p) if p > 0 => settings.proxy_port = p,
                _ => warn!(%port, "CCR_PROXY_PORT 不是合法端口, 使用默认 23456"),
            }
        }
        if let Ok(https) = std::env::var("CCR_HTTPS_PORT") {
            match https.trim().parse::<u16>() {
                Ok(p) if p > 0 => settings.https_port = p,
                _ => warn!(%https, "CCR_HTTPS_PORT 不是合法端口, 使用默认 23457"),
            }
        }
        // 首启允许用环境变量指定代理访问令牌 (给客户端工具用); 之后一律走 UI 轮换。
        if let Ok(token) = std::env::var("CCR_AUTH_TOKEN") {
            if token.chars().count() >= 16 {
                settings.auth_token = token.trim().to_string();
            } else if !token.trim().is_empty() {
                warn!("CCR_AUTH_TOKEN 少于 16 个字符, 已忽略, 使用自动生成的令牌");
            }
        }
    }
}

/// 管理员账号播种。返回生效的用户名。
async fn ensure_admin(state: &AppState) -> anyhow::Result<String> {
    let env_user = std::env::var("CCR_ADMIN_USER").ok().filter(|s| !s.trim().is_empty());
    let env_pass = std::env::var("CCR_ADMIN_PASSWORD").ok().filter(|s| !s.is_empty());
    let force_reset = std::env::var("CCR_ADMIN_RESET").is_ok();

    let username = env_user
        .clone()
        .unwrap_or_else(|| crate::auth_admin::DEFAULT_ADMIN_USERNAME.to_string());
    let existing = crate::auth_admin::count_admins(&state.db).await?;

    if let Some(pass) = env_pass {
        // 环境变量指定了密码: 每次启动都对齐 (同时承担「首次创建」与「忘记密码时重置」)
        crate::auth_admin::ensure_admin_user(&state.db, &username, &pass).await?;
        info!(username = %username, "管理员密码已按 CCR_ADMIN_PASSWORD 设置");
        return Ok(username);
    }

    if existing == 0 || force_reset {
        let pass = crate::auth_admin::generate_password();
        crate::auth_admin::ensure_admin_user(&state.db, &username, &pass).await?;
        println!();
        println!("================================================================");
        println!("  cc-router 服务器首次初始化");
        println!("  管理界面登录账号: {username}");
        println!("  管理界面登录密码: {pass}");
        println!("  (本密码仅打印这一次, 请立即登录并在「设置 → 安全」中修改,");
        println!("   或用 CCR_ADMIN_USER / CCR_ADMIN_PASSWORD 环境变量指定)");
        println!("================================================================");
        println!();
        return Ok(username);
    }

    Ok(env_user.unwrap_or_else(|| {
        // 未指定用户名且已有账号: 保留库里已有的账号, 不做任何改动
        crate::auth_admin::DEFAULT_ADMIN_USERNAME.to_string()
    }))
}

/// 阻塞等待 SIGTERM / SIGINT。
async fn wait_for_shutdown() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("安装 SIGTERM 处理");
        let mut int = signal(SignalKind::interrupt()).expect("安装 SIGINT 处理");
        tokio::select! {
            _ = term.recv() => {},
            _ = int.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
