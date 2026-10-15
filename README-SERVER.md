# cc-router 服务器版

基于 [finch-xu/cc-router](https://github.com/finch-xu/cc-router)（MIT）改造的**服务器部署版**：
把原本跑在本机桌面（Tauri 壳）里的多订阅聚合网关，变成可以跑在任意 Linux 服务器上的
Docker 服务。代理转发核心（协议转换 / 调度 / 故障转移）与上游完全一致，未做改动。

与桌面版的差异：

| 能力 | 桌面版 | 服务器版 |
| --- | --- | --- |
| 运行形态 | macOS / Windows / Linux 桌面 App | 无头 Linux 服务（Docker / 二进制） |
| 管理界面 | 桌面窗口 | 浏览器打开 `http://服务器:23456/ui/`（科技蓝主题） |
| 界面登录 | 免登录（本机可信） | **用户名 + 密码**（强制，Argon2id 落库，防爆破锁定） |
| 代理入口认证 | 访问令牌（可选开启） | 访问令牌（默认开启，首次启动生成） |
| 应用内更新 / 托盘 / TUI / 自启动 | 有 | 无（升级 = 拉取新镜像） |

## 快速开始（Docker Compose）

```bash
# 1. 按需修改 docker-compose.yml 里的 CCR_ADMIN_USER / CCR_ADMIN_PASSWORD
# 2. 构建并启动
docker compose up -d --build

# 3. 看首次启动日志 (管理员密码 / 代理访问令牌)
docker compose logs ccrouter
```

然后浏览器打开 `http://服务器IP:23456/ui/`，用上面设置的用户名密码登录：

1. **订阅管理** → 添加你的各家订阅（DeepSeek / GLM / Kimi / Claude 等预置模板）；
2. **虚拟模型** → 把 `model-opus` / `model-sonnet` / `model-haiku` 绑定到订阅；
3. **设置 → 安全与访问** → 复制「代理访问令牌」。

## 客户端接入

以 Claude Code 为例（`~/.claude/settings.json` 或 shell 环境变量）：

```bash
export ANTHROPIC_BASE_URL="http://服务器IP:23456"
export ANTHROPIC_AUTH_TOKEN="<代理访问令牌>"
export ANTHROPIC_MODEL="model-fable"          # 绑定关系见管理界面「虚拟模型」
export ANTHROPIC_SMALL_FAST_MODEL="model-haiku"
```

OpenAI 兼容端点（Codex / OpenCode 等）：

```text
Chat Completions:  http://服务器IP:23456/v1/chat/completions
Responses:         http://服务器IP:23456/v1/responses
Anthropic Messages: http://服务器IP:23456/v1/messages
模型列表:           http://服务器IP:23456/v1/models
```

认证方式：`x-api-key: <令牌>` 或 `Authorization: Bearer <令牌>`。

## 两套凭证，各管一摊

| 凭证 | 用在哪 | 管理 |
| --- | --- | --- |
| **管理员账号密码** | 登录 `/ui` 管理界面 | 环境变量播种 / 首启随机生成 / UI「设置 → 安全与访问」修改 |
| **代理访问令牌** | 客户端工具调 `/v1/*` | 首启生成（打印到日志）/ UI 里复制、重新生成 |

登录安全机制：Cookie 会话（HttpOnly + SameSite=Strict，30 天滑动过期，上限 32 个）、
POST 全量 CSRF 头校验、按 IP 登录失败 5 次锁 60 秒。密码只存 Argon2id 哈希。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CCR_DATA_DIR` | `/data`（镜像内） | 数据目录：config.db、settings.json、logs、TLS 证书 |
| `CCR_ADMIN_USER` | `admin` | 管理员用户名。设置了密码时每次启动对齐到该组合 |
| `CCR_ADMIN_PASSWORD` | 首启随机生成并打印到日志 | 管理员密码（≥8 字符）。**指定后每次启动都会以环境变量为准**——改完密码记得把变量清掉或同步更新 |
| `CCR_ADMIN_RESET` | 未设置 | 无 `CCR_ADMIN_PASSWORD` 时设为任意值 = 强制重置为新的随机密码（打印到日志） |
| `CCR_PROXY_PORT` | `23456` | 仅首次启动播种 settings.json，之后以界面设置为准 |
| `CCR_HTTPS_PORT` | `23457` | 同上 |
| `CCR_LANG` | `zh` | 首次启动的界面语言（zh / en / ja / system） |
| `CCR_AUTH_TOKEN` | 自动生成 | 首次启动播种代理访问令牌（≥16 字符），之后在 UI 轮换 |
| `CCR_TRUST_PROXY` | 未设置 | `/ui` 前面有 nginx/caddy 时设为 1：登录限流按 `X-Forwarded-For` 的真实客户端 IP 计数 |
| `RUST_LOG` | `info` | 日志级别 |

**每次启动由服务端强制（UI 修改无效）**：监听 `0.0.0.0`、Web UI 开启且强制登录、
TUI/「本机通行」通道关闭。前两项在容器里没有安全替代值；如需限制 `/ui` 的访问范围，
请在反向代理层做（见下节）。

## 反向代理参考（nginx）

典型需求：`/v1/*` 公网可用，`/ui/*` 只允许办公网访问。

```nginx
server {
    listen 443 ssl;
    server_name ccrouter.example.com;

    location /v1/ {
        proxy_pass http://127.0.0.1:23456;
        proxy_http_version 1.1;
        proxy_buffering off;          # SSE 流式响应必须关
        proxy_read_timeout 3600s;     # 长流式请求
    }

    location /ui/ {
        allow 10.0.0.0/8;             # 只放行内网
        deny  all;
        proxy_pass http://127.0.0.1:23456;
        proxy_buffering off;
        proxy_set_header X-Forwarded-For $remote_addr;   # 配合 CCR_TRUST_PROXY=1
    }
}
```

## 数据与升级

- 数据全部在 `./data` 卷：`config.db`（SQLite，含全部订阅与统计）、`settings.json`、
  `logs/`（按天滚动，保留 14 天）。
- 升级：`docker compose pull && docker compose up -d`（或重新 build）。数据库迁移在
  启动时自动执行。
- 备份：管理界面「设置 → 备份与迁移」导出配置 JSON；或直接停容器后拷走 `./data`。
- 恢复出厂：管理界面按钮（清空数据库与设置并自动重启容器）。

## 本地开发 / 构建

```bash
# 前端
pnpm install && pnpm build          # 产物在 dist/

# 后端 (无头服务器形态, 不需要 webkit/GTK)
cd src-tauri
cargo run --no-default-features --features server --bin ccr-server
# 前端产物会被编译期内嵌: 先把 dist/ 拷到 src-tauri/ui-dist/ (或留给 build.rs 的占位页)

# 本机试跑 (数据在 ./data)
CCR_DATA_DIR=./data cargo run --no-default-features --features server --bin ccr-server

# 测试
cargo test --no-default-features --features server --lib
```

桌面形态（`pnpm tauri dev` / `pnpm tauri build`）保持上游原样可用，本仓库不负责其打包发布。

## 与上游的代码差异（server 分支）

- `src-tauri/src/state.rs`：`AppHandle` / `State` 双形态别名（桌面 = tauri 原生；服务器 = 轻量壳 + `&AppState`）；
- `src-tauri/src/lib.rs`：启动序列抽成 `bootstrap_core`，桌面 `run()` 与服务器 `server::run_server()` 共用；
- `src-tauri/src/server.rs` + `src/bin/ccr-server.rs`：服务器入口、安全播种、管理员播种、信号处理；
- `src-tauri/src/auth_admin.rs` + `migrations/025`：管理员账号表与 Argon2id 密码；
- `src-tauri/src/proxy/web/auth.rs`：登录改为用户名 + 密码（会话/CSRF/限流机制沿用上游）；
- `src-tauri/src/proxy/web/assets.rs`：服务器形态用 rust-embed 内嵌 `ui-dist/`；
- Cargo features：`desktop`（默认，Tauri 全家桶）/ `server`（无 Tauri 依赖）；
- 前端：科技蓝主题（唯一主题，明暗可切）、登录页改用户名+密码、设置页隐藏桌面专属项；
- 新增 `Dockerfile` / `docker-compose.yml` / `.dockerignore` / 本文档。

## License

MIT（沿用上游，见 LICENSE 与 THIRD-PARTY-NOTICES.md）。
