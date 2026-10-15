use crate::state::AppHandle;

/// 前端自动检查更新的结果推给托盘: `Some(版本号)` = 有新版本, `None` = 已是最新 / 还没查到。
/// 只从桌面窗口调用 (网页界面那边是拒绝桩, 见 `proxy/web/api.rs`)。
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_tray_update(app: AppHandle, version: Option<String>) {
    #[cfg(feature = "desktop")]
    crate::tray::set_update(&app, version);
    #[cfg(not(feature = "desktop"))]
    {
        let _ = (app, version); // 服务器形态没有托盘
    }
}
