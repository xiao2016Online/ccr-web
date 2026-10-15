# cc-router 服务器版镜像 (无头, 无 Tauri/webkit 依赖)
#
# 构建:  docker build -t ccr-web .
# 运行:  见 docker-compose.yml
#
# 三个阶段:
#   ui     —— pnpm 构建前端 dist/
#   build  —— Rust 编译 ccr-server (前端产物拷入 ui-dist/, 由 rust-embed 编译期内嵌)
#   runtime—— debian-slim 运行层, 非 root 用户, 数据卷 /data

# ---------- 阶段 1: 前端 ----------
FROM node:22-alpine AS ui
WORKDIR /build
# pnpm 版本钉死: 该 lockfile 的 pnpm.overrides 只有较新的 pnpm 仍从 package.json 读取,
# 与本地验证过的版本保持一致 (corepack 自带版本会忽略该字段导致 frozen 安装失败)
RUN npm i -g pnpm@10.33.2 --registry=https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile
COPY index.html postcss.config.js tsconfig.json tsconfig.node.json vite.config.ts components.json ./
COPY src ./src
RUN pnpm build

# ---------- 阶段 2: Rust 编译 ----------
FROM rust:1-slim AS build
# 国内网络: 换 Debian 源 (USTC) 与 crates.io 源 (rsproxy)
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential cmake ninja-build perl pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/cargo \
    && printf '[source.crates-io]\nreplace-with = "rsproxy"\n\n[source.rsproxy]\nregistry = "sparse+https://rsproxy.cn/index/"\n' \
       > /usr/local/cargo/config.toml
WORKDIR /app

# 依赖层缓存: 先用占位源码按同一份 Cargo.toml/lock 把全部第三方依赖编译好,
# 之后源码变动只重编 cc-router 本体。cargo 会编译 manifest 里所有非可选依赖,
# 所以占位 lib/bin 即可覆盖完整依赖树。
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/
COPY src-tauri/crates ./src-tauri/crates
RUN mkdir -p src-tauri/src/bin \
    && echo "pub fn placeholder() {}" > src-tauri/src/lib.rs \
    && echo "fn main() {}" > src-tauri/src/bin/ccr-server.rs
WORKDIR /app/src-tauri
RUN cargo build --release --no-default-features --features server --bin ccr-server

WORKDIR /app
COPY src-tauri ./src-tauri
COPY --from=ui /build/dist ./src-tauri/ui-dist
WORKDIR /app/src-tauri
# rust-embed 在 release 构建期把 ui-dist 内嵌进二进制
RUN cargo build --release --no-default-features --features server --bin ccr-server

# ---------- 阶段 3: 运行层 ----------
FROM debian:trixie-slim
# 国内网络: 换 Debian 源后再装运行时依赖
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 ccrouter \
    && useradd -u 10001 -g ccrouter -m -d /data ccrouter

COPY --from=build /app/src-tauri/target/release/ccr-server /usr/local/bin/ccr-server

ENV CCR_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 23456

USER ccrouter
WORKDIR /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:23456/health || exit 1

ENTRYPOINT ["ccr-server"]
