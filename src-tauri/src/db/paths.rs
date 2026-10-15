//! app 数据目录解析。
//!
//! 桌面形态: OS app data dir (经 Tauri path API)。
//! 服务器形态: `CCR_DATA_DIR` 环境变量;未设置时退回 `./data`
//! (容器镜像里用 `ENV CCR_DATA_DIR=/data` 指到数据卷)。

use std::path::PathBuf;

#[cfg(feature = "desktop")]
use crate::error::AppError;
use crate::error::AppResult;

#[cfg(feature = "desktop")]
pub fn app_data_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("无法获取 app_data_dir: {e}")))
}

#[cfg(not(feature = "desktop"))]
pub fn app_data_dir() -> AppResult<PathBuf> {
    match std::env::var_os("CCR_DATA_DIR") {
        Some(dir) if !dir.is_empty() => Ok(PathBuf::from(dir)),
        _ => Ok(PathBuf::from("data")),
    }
}
