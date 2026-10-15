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
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html postcss.config.js tsconfig.json tsconfig.node.json vite.config.ts components.json ./
COPY src ./src
RUN pnpm build

# ---------- 阶段 2: Rust 编译 ----------
# cargo-chef 做依赖层缓存: 源码改动不重编几百个第三方 crate
FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef

FROM chef AS planner
WORKDIR /app
COPY src-tauri ./src-tauri
WORKDIR /app/src-tauri
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential cmake ninja-build perl pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/src-tauri
COPY --from=planner /app/src-tauri/recipe.json recipe.json
# 依赖编译缓存层 (含 proc-macro; TUI 成员 crate 也在 workspace 内一并缓存)
RUN cargo chef cook --release --no-default-features --features server --recipe-path recipe.json

WORKDIR /app
COPY src-tauri ./src-tauri
COPY --from=ui /build/dist ./src-tauri/ui-dist
WORKDIR /app/src-tauri
# rust-embed 内嵌 ui-dist (release 构建期写进二进制)
RUN touch src-tauri/ui-dist/.keep && cargo build --release --no-default-features --features server --bin ccr-server

# ---------- 阶段 3: 运行层 ----------
FROM debian:bookworm-slim
RUN apt-get update \
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
