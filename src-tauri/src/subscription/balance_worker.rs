//! 余额定时刷新器: 每半小时对所有支持余额查询的订阅静默刷新一次缓存。
//!
//! 范式参考 `recheck_worker` (spawn + `tokio::time::interval` 主循环)。
//!
//! 设计要点:
//! - 只刷 `balance_discovery` 存在且启用的订阅 (当前内置 provider 里只有
//!   DeepSeek / OpenRouter 声明了该接口, 其它订阅零成本跳过);
//! - 顺序逐条刷 (不并行), 对上游余额接口温和 —— 与手动刷新走同一条
//!   `balance_discovery::fetch_and_cache` 路径, 缓存写库 + 写 runtime,
//!   前端列表徽标 / 编辑页下一次查询即拿到新值;
//! - 单条失败只记 debug 日志 (余额是展示性数据, 不值得告警刷屏),
//!   下一个周期自然重试;
//! - 启动后立即刷一次 (`tokio::time::interval` 默认首 tick 即触发),
//!   让重启后的内存缓存尽快有值;
//! - 不做 TTL 判断: 周期本身 (30 分钟) 远大于 provider 的
//!   `cache_ttl_minutes` (10 分钟), 到点必然值得刷。
//!
//! 周期可用 `CCR_BALANCE_REFRESH_SECS` 覆盖 (容器里调大/调小都行,
//! 本地验证时设成 5 秒即可立刻看到效果)。

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::state::AppState;
use crate::subscription::{balance_discovery, model::SubscriptionRuntime};

/// 默认刷新周期: 30 分钟。
const DEFAULT_INTERVAL_SECS: u64 = 1800;

fn interval_secs() -> u64 {
    std::env::var("CCR_BALANCE_REFRESH_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v >= 1)
        .unwrap_or(DEFAULT_INTERVAL_SECS)
}

pub async fn run(state: AppState) {
    let secs = interval_secs();
    info!(interval_secs = secs, "balance_worker started");
    let mut ticker = tokio::time::interval(Duration::from_secs(secs));
    loop {
        ticker.tick().await;
        refresh_all(&state).await;
    }
}

/// 刷一轮。每轮重新扫全表, 这样启动后才新建的订阅在下一轮也能被覆盖。
async fn refresh_all(state: &AppState) {
    // 1. 先只取 Arc 句柄 (外层读锁立刻释放, 不持锁 await 内层读锁)
    let handles: Vec<Arc<RwLock<SubscriptionRuntime>>> = {
        let subs = state.subscriptions.read().await;
        subs.values().cloned().collect()
    };

    // 2. 逐条判断是否支持余额查询, 取 row 快照 (不持锁发请求)
    let mut rows = Vec::new();
    for rt in handles {
        let supported = {
            let g = rt.read().await;
            g.row
                .balance_discovery
                .as_ref()
                .is_some_and(|bd| bd.enabled)
        };
        if supported {
            let g = rt.read().await;
            rows.push(g.row.clone());
        }
    }

    if rows.is_empty() {
        debug!("balance_worker: 无支持余额查询的订阅, 跳过");
        return;
    }

    info!(count = rows.len(), "balance_worker: 开始定时刷新余额");

    // 3. 顺序刷 (对上游余额接口温和)
    for row in rows {
        let sub_id = row.id;
        match balance_discovery::fetch_and_cache(&state.db, &state.http_client, &row).await {
            Ok(snapshot) => debug!(
                %sub_id,
                entries = snapshot.entries.len(),
                "balance_worker: 余额已刷新"
            ),
            Err(e) => {
                // 余额拉取失败不影响代理转发; debug 即可, 下个周期重试
                debug!(%sub_id, error = %e, "balance_worker: 余额刷新失败");
            }
        }
    }
}
