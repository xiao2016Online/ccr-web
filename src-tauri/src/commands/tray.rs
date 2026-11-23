use crate::state::AppHandle;
#[cfg(feature = "desktop")]
use tauri::Manager;

/// 前端自动检查更新的结果推给托盘: `Some(版本号)` = 有新版本, `None` = 已是最新 / 还没查到。
/// 只从桌面窗口调用 (网页界面那边是拒绝桩, 见 `proxy/web/api.rs`)。
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_tray_update(app: AppHandle, version: Option<String>) {
    // 有新版本才发通知 (通知插件在服务器形态也可用)
    if let Some(ref v) = version {
        if let Some(st) = app.try_state::<crate::state::AppState>() {
            st.notify.emit_update_if_new(v);
        }
    }
    #[cfg(feature = "desktop")]
    crate::tray::set_update(&app, version);
    #[cfg(not(feature = "desktop"))]
    {
        let _ = (app, version); // 服务器形态没有托盘
    }
}
