//! TLS 证书管理 Tauri 命令. 前端 Settings 页 HTTPS 区域调用.

use std::path::PathBuf;

use crate::state::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tls;
use crate::tls::TlsStatus;

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn tls_get_status(state: State<'_, AppState>) -> AppResult<TlsStatus> {
    let app_data_dir = state.data_dir.clone();
    tls::read_status(&app_data_dir).await
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn tls_get_ca_pem_path(state: State<'_, AppState>) -> AppResult<String> {
    let app_data_dir = state.data_dir.clone();
    Ok(tls::ca_pem_path(&app_data_dir).to_string_lossy().to_string())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn tls_export_ca_pem(
    state: State<'_, AppState>,
    dest: String,
) -> AppResult<()> {
    let app_data_dir = state.data_dir.clone();
    let dest_path = PathBuf::from(dest);
    // HTTP-only 模式下用户提前导出 CA, 这里按需生成 (跳过 leaf + ServerConfig 构建).
    tls::ensure_ca(&app_data_dir).await?;
    tls::export_ca_pem(&app_data_dir, &dest_path).await
}

/// 网页端导出: 返回 CA PEM 文本, 由浏览器下载. HTTP-only 模式下按需生成 CA.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn tls_get_ca_pem_text(state: State<'_, AppState>) -> AppResult<String> {
    let app_data_dir = state.data_dir.clone();
    tls::ensure_ca(&app_data_dir).await?;
    tokio::fs::read_to_string(tls::ca_pem_path(&app_data_dir))
        .await
        .map_err(AppError::Io)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn tls_regenerate_leaf(state: State<'_, AppState>) -> AppResult<TlsStatus> {
    let app_data_dir = state.data_dir.clone();
    let extra_sans = state.settings.read().await.tls_extra_sans.clone();
    tls::ensure_ca(&app_data_dir).await?;
    tls::regenerate_leaf(&app_data_dir, &extra_sans).await?;
    // 运行中含 HTTPS 就热替换, 新握手立即用新证书; 没在跑 HTTPS 时下次带 HTTPS 启动自然读到.
    // 磁盘上的重新生成已成功, 热替换失败不能让整条命令报错 (下次重启代理仍会读到新证书)
    if let Err(e) = state
        .proxy
        .reload_tls(&crate::proxy::server::AppHooks((*state).clone()))
        .await
    {
        tracing::warn!(error = %e, "叶证书已重新生成, 但热替换运行中的 TLS 配置失败");
    }
    tls::read_status(&app_data_dir).await
}
