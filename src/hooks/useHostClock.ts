import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/tauri";
import type { WallClock } from "@/lib/slotSchedule";

const RESYNC_MS = 60_000;
const TICK_MS = 30_000;

/**
 * 宿主机本地墙钟 (分时段规则按它生效; 网页界面的浏览器时区可能与宿主机不同, 所以不能用
 * 本地时间推算)。每分钟向后端校准一次, 两次校准之间用 `performance.now()` 流逝的分钟数
 * 外推 (跨日递进 weekday), 每 30 秒重渲染一次。首次取到之前返回 null。
 */
export function useHostClock(): WallClock | null {
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["host-clock"],
    queryFn: api.getHostClock,
    refetchInterval: RESYNC_MS,
    staleTime: 0,
  });
  // 每次拿到新读数就记下当时的单调时间, 之后只靠它外推。
  const base = useRef<{ stamp: number; data: typeof data; at: number } | null>(null);
  if (data && base.current?.stamp !== dataUpdatedAt) {
    base.current = { stamp: dataUpdatedAt, data, at: performance.now() };
  }
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const b = base.current;
  if (!b || !b.data) return null;
  const elapsedMin = Math.floor((performance.now() - b.at) / 60_000);
  const total = b.data.minute + elapsedMin;
  const dayShift = Math.floor(total / 1440);
  return {
    weekday: ((b.data.weekday - 1 + dayShift) % 7) + 1,
    minute: total % 1440,
  };
}
