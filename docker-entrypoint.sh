#!/bin/sh
# cc-router 容器入口。
#
# 为什么需要它: 服务以非 root 用户 (ccrouter, uid 10001) 运行, 而数据目录常以
# bind mount 挂载宿主机路径 (./data:/data) —— Docker 自动创建该目录时属主是
# 宿主机 root, 容器内的 ccrouter 写不进去, 启动时报 "Permission denied (os error 13)"。
# 这里以 root 做一次属主修正再降权执行:
#   - 属主已是 ccrouter 且可写 → 直接降权 (零开销);
#   - 否则 chown -R 后降权 (数据目录通常 <100MB, 只会在首次或异常时发生)。
# 如果集群策略要求容器全程非 root (如 K8s securityContext), compose 里显式
# `user: "10001:10001"` 即可跳过本脚本的 root 段, 此时数据目录仍需预先可写。
set -e

if [ "$(id -u)" = "0" ]; then
  data_dir="${CCR_DATA_DIR:-/data}"
  mkdir -p "$data_dir"
  if [ "$(stat -c '%u' "$data_dir")" != "10001" ] || ! gosu ccrouter test -w "$data_dir"; then
    echo "ccr-server: 修正数据目录属主 $data_dir -> ccrouter" >&2
    chown -R ccrouter:ccrouter "$data_dir"
  fi
  exec gosu ccrouter "$@"
fi

exec "$@"
