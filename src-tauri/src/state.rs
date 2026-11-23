use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::oauth::chatgpt::ChatGptOAuthManager;
use crate::oauth::kiro::KiroOAuthManager;
use crate::observability::body_dump::BodyDumpEntry;
use crate::observability::events::EventEntry;
use crate::observability::request_log::RequestLogEntry;
use crate::provider::registry::ProviderRegistry;
use crate::proxy::web::auth::{LoginGuard, SessionStore};
use crate::proxy::web::events::UiEvent;
use crate::settings::model::Settings;
use crate::subscription::model::SubscriptionRuntime;
use crate::virtual_model::affinity::AffinityTable;
use crate::virtual_model::model::{VirtualModelConfig, VirtualModelName};

// ---------------------------------------------------------------------------
// 桌面 / 服务器双形态兼容层。
//
// 桌面 (feature = "desktop", 默认): 进程由 Tauri 壳拉起, `AppHandle` 就是
// tauri::AppHandle —— 事件经 Tauri emit 再由 proxy::web::events::install_bridge
// 转投 SSE 广播; `State` 是 invoke 通道的提取器。
//
// 服务器 (--no-default-features --features server): 无 Tauri 壳, `AppHandle`
// 换成一个只装着 SSE 广播发送端的轻量壳, emit 直接进广播 (少一跳);
// `State` 退化为 &AppState, 由 /ui/api/cmd 分发器直接传入。
// 两种形态下业务代码的调用写法完全一致 (app.emit(...) / state.db ...)。
// ---------------------------------------------------------------------------

/// 事件发射与进程句柄。桌面 = tauri::AppHandle;服务器 = 轻量壳 (见下方 inherent emit)。
#[cfg(feature = "desktop")]
pub type AppHandle = tauri::AppHandle;

#[cfg(not(feature = "desktop"))]
#[derive(Clone)]
pub struct AppHandle {
    ui_events: tokio::sync::broadcast::Sender<UiEvent>,
    /// 启动完成后挂上的全局状态。上游 v7 的部分共享代码写 `app.try_state::<AppState>()`
    /// (桌面走 Tauri 的 Manager), 这里给出同形入口, 免得每个调用点都写 cfg。
    state_slot: Arc<std::sync::OnceLock<AppState>>,
}

#[cfg(not(feature = "desktop"))]
impl AppHandle {
    pub fn new(ui_events: tokio::sync::broadcast::Sender<UiEvent>) -> Self {
        Self {
            ui_events,
            state_slot: Arc::new(std::sync::OnceLock::new()),
        }
    }

    /// 启动序列构造出 AppState 后调用一次 (重复调用忽略)。
    pub fn attach_state(&self, state: AppState) {
        let _ = self.state_slot.set(state);
    }

    /// 与 `tauri::Manager::try_state` 同形: 服务器形态只装了 AppState。
    pub fn try_state<T: 'static>(&self) -> Option<&T> {
        let state = self.state_slot.get()?;
        (state as &dyn std::any::Any).downcast_ref::<T>()
    }

    /// 与桌面 `tauri::Emitter::emit` 同形的事件发射口: payload 序列化后写进
    /// /ui/api/events 的 SSE 广播。无订阅者时 send 返回 Err, 与桌面行为一致地忽略。
    pub fn emit<T: serde::Serialize>(
        &self,
        name: &str,
        payload: T,
    ) -> Result<(), serde_json::Error> {
        let payload = serde_json::to_string(&payload)?;
        let _ = self.ui_events.send(UiEvent {
            name: name.to_string(),
            payload,
        });
        Ok(())
    }
}

/// 命令层状态提取器。桌面 = `tauri::State` (invoke 通道);服务器 = `&AppState`
/// (HTTP `/ui/api/cmd` 通道)。两者都 Deref 到 AppState, 命令函数体无感。
#[cfg(feature = "desktop")]
pub type State<'a, T = AppState> = tauri::State<'a, T>;

#[cfg(not(feature = "desktop"))]
pub type State<'a, T = AppState> = &'a T;

/// 全局 app 状态。所有 Tauri commands、代理服务、后台任务都共享这份状态。
#[derive(Clone)]
pub struct AppState {
    /// 数据目录 (config.db / settings.json / logs / TLS 所在)。
    /// 桌面 = OS app data dir;服务器 = CCR_DATA_DIR (或其缺省值), 启动时解析一次。
    pub data_dir: PathBuf,
    pub db: sqlx::SqlitePool,
    /// 厂商注册表 (内置 + 厂商插件)。读用 [`AppState::providers`], 装 / 卸 / 启停插件时整体替换。
    pub providers: Arc<std::sync::RwLock<Arc<ProviderRegistry>>>,
    /// 计价注册表 (已启用的计价插件)。读用 [`AppState::pricing`], 与厂商注册表同时重建。
    pub pricing: Arc<std::sync::RwLock<Arc<crate::plugins::pricing::PricingRegistry>>>,
    /// 规则注册表 (已启用的规则插件 + 已解析参数)。读用 [`AppState::rules`], 与厂商 / 计价注册表同时重建。
    pub rules: Arc<std::sync::RwLock<Arc<crate::plugins::rules::RulesRegistry>>>,
    /// 通知插件注册表 (已启用的通知插件 + 已解析参数)。读用 [`AppState::notifiers`], 随 `rebuild_runtime` 重建。
    pub notifiers: Arc<std::sync::RwLock<Arc<crate::plugins::notifier::NotifierRegistry>>>,
    /// 通知投递中心 (通知插件 + 内置桌面通知共用去重、限流与内存发送记录)。
    pub notify: Arc<crate::notify::NotifyHub>,
    /// 实时路由的内存环形缓冲 (请求日志消费端写入, 实时路由首屏与 SSE 读取)。
    pub live_feed: Arc<crate::observability::live_feed::LiveFeed>,
    pub subscriptions: Arc<RwLock<HashMap<Uuid, Arc<RwLock<SubscriptionRuntime>>>>>,
    /// Serializes route writes, subscription removal, and backup imports across SQLite and memory.
    pub route_edits: Arc<tokio::sync::Mutex<()>>,
    pub virtual_models: Arc<RwLock<HashMap<VirtualModelName, VirtualModelConfig>>>,
    pub settings: Arc<RwLock<Settings>>,
    /// HTTP listener 实际绑定到的端口. None=HTTP listener 未启用 (HTTPS-only 模式).
    /// 实际值在每次绑定完成后写入, 可能因端口冲突 +1 与 settings.proxy_port 不同.
    pub http_bound_port: Arc<RwLock<Option<u16>>>,
    /// HTTPS listener 实际绑定到的端口. None=HTTPS listener 未启用 (HTTP-only 模式).
    pub https_bound_port: Arc<RwLock<Option<u16>>>,
    /// 代理 listener 的生命周期 (启动 / 重启 / 回滚 / 证书热替换). 上面两个 bound_port
    /// 由它在绑定成功 / 停止时维护.
    pub proxy: Arc<crate::proxy::controller::ProxyController>,
    pub request_log_tx: mpsc::Sender<RequestLogEntry>,
    pub event_log_tx: mpsc::Sender<EventEntry>,
    /// 调试模式 dump channel. 仅在 settings.debug_mode=true 时被插桩点投递,
    /// consumer 在 lib.rs::bootstrap 起的后台任务里把每条 entry 写成一个 .txt 文件.
    pub body_dump_tx: mpsc::Sender<BodyDumpEntry>,
    pub http_client: reqwest::Client,
    /// 短超时(30s) 单例, 仅用于订阅可达性探测(测试连接 + 后台巡检)。
    /// 与 `http_client` (600s 空闲超时, 无总上限) 分离: 探测期望快速判定, 慢响应等同失败。
    pub probe_client: reqwest::Client,
    /// ChatGPT OAuth manager (Phase 1 接入). 全订阅共享一份, 内含每订阅 access_token 缓存与 refresh 锁.
    pub chatgpt_oauth: Arc<ChatGptOAuthManager>,
    pub kiro_oauth: Arc<KiroOAuthManager>,
    pub app_handle: AppHandle,
    /// sticky 模式的会话 → 订阅亲和表. 内存, 不持久化.
    pub session_affinity: Arc<std::sync::Mutex<AffinityTable>>,
    /// 网页界面会话表 (内存, 不持久化). generate_new_token 时清空.
    pub web_sessions: Arc<std::sync::Mutex<SessionStore>>,
    /// 网页登录按 IP 限流表.
    pub web_login_guard: Arc<std::sync::Mutex<LoginGuard>>,
    /// Tauri emit 事件的广播副本, 供 /ui/api/events SSE 订阅. 无订阅者时 send 返回 Err, 忽略即可.
    pub ui_events: tokio::sync::broadcast::Sender<UiEvent>,
    /// 「本机通行」密钥 (cc-router-tui 用). 每次启动重新生成, 只存在于内存和 runtime.json,
    /// 不进 settings / DB / 任何 DTO。读取方只有 proxy/server.rs (写文件) 与 proxy/web/ 的两个中间件。
    pub local_secret: Arc<String>,
}

impl AppState {
    /// 当前厂商注册表的快照。
    pub fn providers(&self) -> Arc<ProviderRegistry> {
        self.providers.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// 当前计价注册表的快照 (空 = 没有启用的计价插件, 界面不显示任何费用)。
    pub fn pricing(&self) -> Arc<crate::plugins::pricing::PricingRegistry> {
        self.pricing.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_pricing(&self, registry: crate::plugins::pricing::PricingRegistry) {
        *self.pricing.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(registry);
    }

    /// 当前规则注册表的快照 (空 = 没有启用的规则插件)。
    pub fn rules(&self) -> Arc<crate::plugins::rules::RulesRegistry> {
        self.rules.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_rules(&self, registry: crate::plugins::rules::RulesRegistry) {
        *self.rules.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(registry);
    }

    /// 当前通知插件注册表的快照。
    pub fn notifiers(&self) -> Arc<crate::plugins::notifier::NotifierRegistry> {
        self.notifiers.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_notifiers(&self, registry: crate::plugins::notifier::NotifierRegistry) {
        *self.notifiers.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(registry);
    }

    /// 整体替换厂商注册表 (装 / 卸 / 启停厂商插件后)。
    pub fn set_providers(&self, registry: ProviderRegistry) {
        *self.providers.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(registry);
    }

    pub async fn get_subscription(
        &self,
        id: &Uuid,
    ) -> Option<Arc<RwLock<SubscriptionRuntime>>> {
        let subs = self.subscriptions.read().await;
        subs.get(id).cloned()
    }

    /// 客户端工具应连接的 cc-router 本地代理 URL.
    /// 选择顺序: 实际绑定的 HTTP 端口 → 实际绑定的 HTTPS 端口 → settings.proxy_port (尚未起来时的 fallback).
    /// 单一来源, env_snippet / integrations / proxy_status 全部走它,避免 scheme 与端口漂移.
    pub async fn local_base_url(&self) -> String {
        let http_port = *self.http_bound_port.read().await;
        let https_port = *self.https_bound_port.read().await;
        if let Some(p) = http_port {
            format!("http://127.0.0.1:{p}")
        } else if let Some(p) = https_port {
            format!("https://127.0.0.1:{p}")
        } else {
            let configured = self.settings.read().await.proxy_port;
            format!("http://127.0.0.1:{configured}")
        }
    }
}
