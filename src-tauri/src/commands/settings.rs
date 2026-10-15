use crate::state::State;

use crate::error::AppResult;
use crate::settings::model::{Settings, SettingsPatch};
use crate::settings::{generate_token, save};
use crate::state::AppState;

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.settings.read().await.clone())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn update_settings(
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> AppResult<Settings> {
    apply_settings_patch(&state, patch).await
}

/// `update_settings` 的实体, 托盘「开机自动启动」勾选框也走这里 —— 两个入口共用
/// 「先改系统登录项、成功才落盘」的顺序与语言切换的托盘重建。
pub(crate) async fn apply_settings_patch(
    state: &AppState,
    patch: SettingsPatch,
) -> AppResult<Settings> {
    let _autostart_change = patch.autostart;

    // autostart 副作用必须先成功才 apply, 否则 UI 显示「已启用」但 LaunchAgent 没注册.
    // 这里涉及文件系统 / Registry, 失败可能性真实存在, 所以是先决条件而非事后通知.
    // 服务器形态没有 OS 登录项概念, patch 里的 autostart 直接忽略 (settings.json 仍存这个值, 无副作用).
    #[cfg(feature = "desktop")]
    if let Some(want) = _autostart_change {
        use tauri_plugin_autostart::ManagerExt;
        let manager = state.app_handle.autolaunch();
        let outcome = if want { manager.enable() } else { manager.disable() };
        if let Err(e) = outcome {
            return Err(crate::error::AppError::internal(format!(
                "autostart toggle failed: {e}"
            )));
        }
    }

    let mut guard = state.settings.write().await;
    // 比对前后值而不是直接看 patch.preferred_language.is_some():
    // 前端每次点 select 都会发同一个值, 没变就别去动 NSMenu.
    let prev_language = guard.preferred_language.clone();
    guard.apply_patch(patch);
    let _language_changed = guard.preferred_language != prev_language;
    save(&state.data_dir, &guard).await?;
    let snapshot = guard.clone();
    drop(guard);

    // 托盘菜单文案跟随 UI 语言. 与 autostart 相反, 这是事后副作用:
    // 菜单没跟上语言只是观感问题, 不该让设置保存失败.
    // 以下两段都是桌面专属 (托盘 / 主线程派发), 服务器形态跳过.
    #[cfg(feature = "desktop")]
    if _language_changed {
        let handle = state.app_handle.clone();
        let locale = crate::tray::TrayLocale::from_pref(&snapshot.preferred_language);
        // 整段派到主线程一次: muda 的 NSMenu 只能主线程碰, 而 tauri 的每个菜单 API
        // (MenuItem::with_id / Menu::new / append_items / set_menu) 都各做一次
        // run_on_main_thread + mpsc::recv 同步等待. 在这里一次性跨过去, 内层调用
        // 因为已经在主线程上会同步短路 (tauri-runtime-wry send_user_message 的主线程分支),
        // 既不在 tokio worker 上阻塞, 也把 5 次跨线程往返压成 1 次.
        if let Err(e) = state.app_handle.run_on_main_thread(move || {
            crate::tray::rebuild_menu(&handle, locale);
        }) {
            tracing::warn!(error = %e, "failed to dispatch tray menu rebuild");
        }
    }
    // 开机自启在设置页被改时, 托盘的勾选框跟上
    #[cfg(feature = "desktop")]
    if _autostart_change.is_some() {
        crate::tray::refresh(&state.app_handle);
    }

    Ok(snapshot)
}

/// 替换 auth_token 并立即持久化; 网页会话凭旧 token 登录, 换 token 后全部作废。
/// 「重新生成令牌」与「导入配置时带入令牌」共用, 保证副作用一致。
pub(crate) async fn replace_auth_token(state: &AppState, token: String) -> AppResult<Settings> {
    let mut guard = state.settings.write().await;
    guard.auth_token = token;
    save(&state.data_dir, &guard).await?;
    if let Ok(mut sessions) = state.web_sessions.lock() {
        sessions.clear();
    }
    Ok(guard.clone())
}

/// 重新生成 auth_token 并立即持久化。返回新 settings 让前端拿到新 token 显示。
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn generate_new_token(state: State<'_, AppState>) -> AppResult<Settings> {
    replace_auth_token(&state, generate_token()).await
}

/// 修改管理界面登录密码。需先验证旧密码; 成功后立即生效 (已有会话保持有效,
/// 新登录用新密码)。任何形态下都可用 —— 服务器版的管理员改密入口就在这里。
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn change_admin_password(
    state: State<'_, AppState>,
    username: String,
    old_password: String,
    new_password: String,
) -> AppResult<()> {
    if new_password.chars().count() < 8 {
        return Err(crate::error::AppError::BadRequest(
            "新密码至少需要 8 个字符".into(),
        ));
    }
    let db = state.db.clone();
    crate::auth_admin::change_password(&db, &username, &old_password, &new_password).await
}
