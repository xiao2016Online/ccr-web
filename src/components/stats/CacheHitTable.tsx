import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useProviders } from "@/hooks/useProviders";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { useT } from "@/i18n";
import { fmtCompact, fmtNum } from "@/lib/format";
import type { BreakdownDto, ProviderInfo, SubscriptionDto } from "@/types";
import { StatsCard } from "./StatsCard";

/**
 * 按订阅的缓存命中表。
 *
 * 口径与统计页 KPI「缓存读取占比」一致:
 *   读取率 = cache_read / (input + cache_creation + cache_read)
 * 即输入侧 token 中有多大比例命中了缓存 (Anthropic 缓存读取按 0.1 倍计费, 越高越省额度)。
 *
 * 三段堆叠条: 深蓝=命中读取, 中蓝=缓存写入, 灰=未命中输入。
 * 缓存 token 只在流式请求中提取 (非流式恒为 0), 会轻微稀释比率 —— 副标题已注明。
 */
export function CacheHitTable({
  items,
  loading,
  errorText,
}: {
  items: BreakdownDto[];
  loading?: boolean;
  errorText?: string | null;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const subs = useSubscriptions();
  const providers = useProviders();

  const subById = useMemo(
    () => new Map<string, SubscriptionDto>((subs.data ?? []).map((s) => [s.id, s])),
    [subs.data],
  );
  const providerById = useMemo(
    () => new Map<string, ProviderInfo>((providers.data ?? []).map((p) => [p.id, p])),
    [providers.data],
  );

  // 只保留输入侧有数据的订阅, 按读取率降序 (想看的就是"谁的缓存用得好")
  const rows = useMemo(
    () =>
      items
        .map((it) => {
          const inputSide =
            it.total_input_tokens + it.total_cache_creation_tokens + it.total_cache_read_tokens;
          const readRate = inputSide > 0 ? (it.total_cache_read_tokens / inputSide) * 100 : 0;
          const writeRate = inputSide > 0 ? (it.total_cache_creation_tokens / inputSide) * 100 : 0;
          return { it, inputSide, readRate, writeRate };
        })
        .filter((r) => r.inputSide > 0)
        .sort((a, b) => b.readRate - a.readRate),
    [items],
  );

  const LEGEND = [
    { label: t("stats.cacheHit.legend.read"), color: "var(--seq-4)" },
    { label: t("stats.cacheHit.legend.write"), color: "var(--seq-3)" },
    { label: t("stats.cacheHit.legend.miss"), color: "var(--ink-5)" },
  ];

  return (
    <StatsCard
      title={t("stats.cacheHit.title")}
      subtitle={t("stats.cacheHit.subtitle")}
      isEmpty={rows.length === 0}
      emptyText={t("stats.cacheHit.empty")}
      loading={loading}
      errorText={errorText}
    >
      <table className="table stats-sub-table">
        <thead>
          <tr>
            <th>{t("stats.cacheHit.col.subscription")}</th>
            <th style={{ width: 220 }}>{t("stats.cacheHit.col.composition")}</th>
            <th style={{ width: 110, textAlign: "right" }}>{t("stats.cacheHit.col.readRate")}</th>
            <th style={{ width: 120, textAlign: "right" }}>{t("stats.cacheHit.col.readTotal")}</th>
            <th style={{ width: 100, textAlign: "right" }}>{t("stats.cacheHit.col.requests")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ it, inputSide, readRate, writeRate }) => {
            const sub = subById.get(it.key);
            const provider = sub ? providerById.get(sub.provider_id) : undefined;
            const readPct = (it.total_cache_read_tokens / inputSide) * 100;
            const writePct = writeRate;
            return (
              <tr
                key={it.key}
                onClick={() => navigate(`/request-logs?subscription_id=${it.key}`)}
                style={{ cursor: "pointer" }}
                title={t("stats.cacheHit.rowTip", {
                  read: it.total_cache_read_tokens,
                  write: it.total_cache_creation_tokens,
                  miss: it.total_input_tokens,
                })}
              >
                <td>
                  <div className="cell-with-icon">
                    <ProviderLogo
                      iconId={provider?.icon ?? sub?.provider_icon}
                      size={18}
                      iconSize={12}
                    />
                    <span className="cell-with-icon-label">{it.label}</span>
                  </div>
                </td>
                <td>
                  <div
                    style={{
                      display: "flex",
                      height: 8,
                      width: "100%",
                      overflow: "hidden",
                      borderRadius: 4,
                    }}
                    aria-hidden="true"
                  >
                    <div style={{ width: `${readPct}%`, background: "var(--seq-4)" }} />
                    <div style={{ width: `${writePct}%`, background: "var(--seq-3)" }} />
                    <div style={{ flex: 1, background: "var(--ink-5)" }} />
                  </div>
                </td>
                <td className="mono tnum strong" style={{ textAlign: "right" }}>
                  {readRate.toFixed(1)}%
                </td>
                <td className="mono tnum" style={{ textAlign: "right" }}>
                  {fmtCompact(it.total_cache_read_tokens)}
                </td>
                <td className="mono tnum" style={{ textAlign: "right" }}>
                  {fmtNum(it.request_count)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        className="chart-legend"
        style={{ marginTop: 10 }}
        aria-hidden="true"
      >
        {LEGEND.map((l) => (
          <span key={l.label} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </StatsCard>
  );
}
