use crate::error::AppResult;
#[cfg(feature = "desktop")]
use tauri::Emitter;

use crate::state::State;
use crate::release_notes::{self, ReleaseNotesDto};
use crate::settings::save;
use crate::state::AppState;

/// 全部内嵌的更新内容 + 该自动弹出的版本 (spec §4.5)。
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn get_release_notes(state: State<'_, AppState>) -> AppResult<ReleaseNotesDto> {
    let last_seen = state.settings.read().await.last_seen_release_notes.clone();
    Ok(release_notes::dto(last_seen.as_deref()))
}

/// 关闭弹窗时调用: 记下当前版本。由后端写自己的 CARGO_PKG_VERSION, 前端不传版本号。
/// 发 settings_changed (已桥接到网页界面), 另一端的未读星号跟着消失。
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn mark_release_notes_seen(state: State<'_, AppState>) -> AppResult<()> {
    // 先拿目录再改内存: 取目录失败时内存里的设置保持原样
    let app_data_dir = state.data_dir.clone();
    let mut guard = state.settings.write().await;
    guard.last_seen_release_notes = Some(env!("CARGO_PKG_VERSION").to_string());
    save(&app_data_dir, &guard).await?;
    drop(guard);
    let _ = state.app_handle.emit("settings_changed", ());
    Ok(())
}
