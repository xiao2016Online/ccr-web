//! cc-router 无头服务器入口。
//!
//! 构建: `cargo build --release --no-default-features --features server --bin ccr-server`
//! (默认 feature 集是桌面形态, 该二进制不会被构建)。

#[tokio::main]
async fn main() {
    if let Err(e) = cc_router_lib::server::run_server().await {
        eprintln!("cc-router server 启动失败: {e:#}");
        std::process::exit(1);
    }
}
