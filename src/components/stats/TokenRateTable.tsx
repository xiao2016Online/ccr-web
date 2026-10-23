import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useProviders } from "@/hooks/useProviders";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { useT } from "@/i18n";
import { fmtCompact, fmtNum } from "@/lib/format";
import type { ProviderInfo, SubscriptionDto, TokenRateDto } from "@/types";
import { StatsCard } from "./StatsCard";

/**
 * 按订阅的输出速率表 (tokens/s)。
 *
 * 口径: 解码速率 = 输出 token / (总耗时 - 首字延迟), 只统计流式成功请求
 * (非流式没有首字延迟数据)。条形长度相对最快的订阅, 一眼看出谁快谁慢。
 */
export function TokenRateTable({
  items,
  loading,
  errorText,
}: {
  items: TokenRateDto[];
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
  const maxRate = Math.max(...items.map((it) => it.tokens_per_sec), 1);

  return (
    <StatsCard
      title={t("stats.tokenRate.title")}
      subtitle={t("stats.tokenRate.subtitle")}
      isEmpty={items.length === 0}
      emptyText={t("stats.tokenRate.empty")}
      loading={loading}
      errorText={errorText}
    >
      <table className="table stats-sub-table">
        <thead>
          <tr>
            <th>{t("stats.tokenRate.col.subscription")}</th>
            <th style={{ width: 200, textAlign: "right" }}>{t("stats.tokenRate.col.rate")}</th>
            <th style={{ width: 110, textAlign: "right" }}>{t("stats.tokenRate.col.samples")}</th>
            <th style={{ width: 130, textAlign: "right" }}>{t("stats.tokenRate.col.avgOutput")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const sub = subById.get(it.key);
            const provider = sub ? providerById.get(sub.provider_id) : undefined;
            const share = (it.tokens_per_sec / maxRate) * 100;
            return (
              <tr
                key={it.key}
                onClick={() => navigate(`/request-logs?subscription_id=${it.key}`)}
                style={{ cursor: "pointer" }}
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
                <td style={{ textAlign: "right" }}>
                  <div className="share-cell">
                    <span className="share-bar" aria-hidden="true">
                      <span className="share-bar-fill" style={{ width: `${share}%` }} />
                    </span>
                    <span className="mono tnum strong">
                      {it.tokens_per_sec.toFixed(1)}
                      <span style={{ fontSize: 10.5, color: "var(--ink-3)", marginLeft: 2 }}>
                        {t("stats.tokenRate.unit")}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="mono tnum" style={{ textAlign: "right" }}>
                  {fmtNum(it.sample_count)}
                </td>
                <td className="mono tnum" style={{ textAlign: "right" }}>
                  {fmtCompact(Math.round(it.avg_output_tokens))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </StatsCard>
  );
}
