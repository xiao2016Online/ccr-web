import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useT } from "@/i18n";
import { useDailySeries, useOverallStats } from "@/hooks/useStatistics";
import { useProxyStatus } from "@/hooks/useSettings";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { buildSeriesBuckets, isHourlyRange } from "@/components/stats/series";
import { DailyRequestsChart } from "@/components/stats/DailyRequestsChart";
import { StatusBadge, stateLabel } from "@/components/StatusBadge";
import { ProviderLogo } from "@/components/ProviderLogo";
import { runtime } from "@/runtime";
import { Spinner } from "@/components/Spinner";
import { fmtCompact, fmtNum } from "@/lib/format";
import type { SubscriptionDto, SubscriptionState } from "@/types";

/** 异常订阅按严重度排序: 鉴权失败最需要处理, 其次是额度耗尽。 */
const SEVERITY: Record<SubscriptionState, number> = {
  auth_failed: 0,
  quota_exhausted: 1,
  rate_limited: 2,
  transient_error: 3,
  disabled: 4,
  healthy: 5,
};

/**
 * 首页概览: 今日用量 + 趋势 + 代理状态 + 订阅健康。
 * 数据全部来自现有命令 (统计 / 代理状态 / 订阅列表), 不引入新的后端接口。
 */
export function OverviewPage() {
  const { t } = useT();
  const queryClient = useQueryClient();

  const todayStats = useOverallStats("today");
  const todaySeries = useDailySeries("today");
  const weekSeries = useDailySeries("last7_days");
  const proxy = useProxyStatus();
  const subs = useSubscriptions();

  const todayBuckets = useMemo(
    () => buildSeriesBuckets(todaySeries.data ?? [], "today"),
    [todaySeries.data],
  );
  const weekBuckets = useMemo(
    () => buildSeriesBuckets(weekSeries.data ?? [], "last7_days"),
    [weekSeries.data],
  );

  const allSubs = subs.data ?? [];
  const abnormal = useMemo(
    () =>
      allSubs
        .filter((s) => !s.is_dispatchable || s.state !== "healthy")
        .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state]),
    [allSubs],
  );
  const healthyCount = allSubs.filter((s) => s.is_dispatchable).length;

  const refreshing =
    todayStats.isFetching || proxy.isFetching || subs.isFetching;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["statistics"] });
    void queryClient.invalidateQueries({ queryKey: ["proxy-status"] });
    void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
  }

  const o = todayStats.data;
  const total = o?.total_requests ?? 0;
  const failCount = (o?.error_count ?? 0) + (o?.timeout_count ?? 0);
  const inputTokens = o?.total_input_tokens ?? 0;
  const outputTokens = o?.total_output_tokens ?? 0;

  return (
    <>
      <div className="page-actions">
        <div className="page-header" style={{ margin: 0 }}>
          <h1>{t("overview.title")}</h1>
          <div className="subtitle">{t("overview.subtitle")}</div>
        </div>
        <button className="btn" type="button" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Spinner /> : <RefreshCw size={13} />}
          {t("overview.refresh")}
        </button>
      </div>

      {/* 今日核心指标 */}
      <div className={"stats-kpi" + (todayStats.isLoading ? " is-loading" : "")}>
        <div className="stat">
          <div className="stat-label">{t("overview.kpi.requests")}</div>
          <div className="stat-val tnum">{fmtNum(total)}</div>
          <div className="stat-delta">
            {fmtNum(o?.success_count ?? 0)} ✓ · {fmtNum(failCount)} ✕
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("overview.kpi.successRate")}</div>
          <div className="stat-val tnum">
            {(o?.success_rate_pct ?? 0).toFixed(1)}
            <span className="stat-unit">%</span>
          </div>
          <div className={"stat-delta" + (failCount > 0 ? " down" : "")}>
            {t("overview.kpi.failedFormat", { failed: fmtNum(failCount), total: fmtNum(total) })}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("overview.kpi.tokens")}</div>
          <div className="stat-val tnum">{fmtCompact(inputTokens + outputTokens)}</div>
          <div className="stat-delta">
            {t("overview.kpi.tokensSub", {
              input: fmtCompact(inputTokens),
              output: fmtCompact(outputTokens),
            })}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("overview.kpi.avgDuration")}</div>
          <div className="stat-val tnum">
            {o?.avg_duration_ms != null ? (o.avg_duration_ms / 1000).toFixed(2) : "-"}
            <span className="stat-unit">s</span>
          </div>
          <div className="stat-delta">
            {o?.p95_duration_ms != null
              ? `${t("overview.kpi.p95Prefix")}${(o.p95_duration_ms / 1000).toFixed(2)}s`
              : " "}
          </div>
        </div>
      </div>

      {/* 今日趋势 + 代理状态 */}
      <div className="stats-grid-2" style={{ marginTop: 16 }}>
        <DailyRequestsChart
          buckets={todayBuckets}
          hourly={isHourlyRange("today")}
          loading={todaySeries.isLoading}
          errorText={todaySeries.isError ? t("overview.loadFailed") : null}
        />
        <ProxyCard
          running={proxy.data?.running ?? false}
          baseUrl={proxy.data?.base_url ?? ""}
          listenAll={proxy.data?.listen_all ?? false}
          port={proxy.data?.port ?? 0}
          lastError={proxy.data?.last_error ?? null}
          restartPending={proxy.data?.restart_pending ?? false}
          loading={proxy.isLoading}
        />
      </div>

      {/* 订阅健康 */}
      <SubscriptionHealthCard
        total={allSubs.length}
        healthy={healthyCount}
        abnormal={abnormal}
        loading={subs.isLoading}
        errorText={subs.isError ? t("overview.loadFailed") : null}
      />

      {/* 近 7 天趋势 */}
      <div style={{ marginTop: 16 }}>
        <DailyRequestsChart
          buckets={weekBuckets}
          hourly={false}
          loading={weekSeries.isLoading}
          errorText={weekSeries.isError ? t("overview.loadFailed") : null}
        />
      </div>
    </>
  );
}

/** 代理运行状态 + 客户端接入地址。 */
function ProxyCard({
  running,
  baseUrl,
  listenAll,
  port,
  lastError,
  restartPending,
  loading,
}: {
  running: boolean;
  baseUrl: string;
  listenAll: boolean;
  port: number;
  lastError: string | null;
  restartPending: boolean;
  loading: boolean;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <section className={"stats-section" + (loading ? " is-loading" : "")}>
      <div className="stats-section-header stats-card-head">
        <div>
          <div className="stats-section-title">{t("overview.proxy.title")}</div>
          <div className="stats-section-subtitle">{t("overview.proxy.subtitle")}</div>
        </div>
      </div>
      <div className="stats-body">
        <div className="setting-row" style={{ paddingTop: 0 }}>
          <div className="label-col">{t("overview.proxy.status")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className={"status-dot " + (running ? "status-dot-ok" : "status-dot-err")}
              aria-hidden
            />
            <span style={{ fontSize: 13 }}>
              {running ? t("overview.proxy.running") : t("overview.proxy.stopped")}
            </span>
            {running && (
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {listenAll ? "0.0.0.0" : "127.0.0.1"}:{port}
              </span>
            )}
          </div>
        </div>

        {running && baseUrl && (
          <div className="setting-row">
            <div className="label-col">{t("overview.proxy.baseUrl")}</div>
            {/* 不用 CopyableBlock: 它是 flex + 定宽 label 列, 在半宽卡片里会被裁切。
                这里给等宽文本 + 一个图标按钮, 自适应剩余宽度。 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <code
                className="mono"
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                  padding: "6px 10px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line-2)",
                  borderRadius: "var(--r-md)",
                  color: "var(--ink-2)",
                }}
              >
                {baseUrl}
              </code>
              <button
                className="btn sm"
                type="button"
                onClick={() => {
                  void runtime.copyText(baseUrl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
                title={t("overview.proxy.copy")}
                aria-label={t("overview.proxy.copy")}
                style={{ flexShrink: 0 }}
              >
                {copied ? <Check size={12} style={{ color: "var(--ok)" }} /> : <Copy size={12} />}
              </button>
            </div>
          </div>
        )}

        {restartPending && (
          <div className="alert warn" style={{ marginTop: 8 }}>
            {t("overview.proxy.restartPending")}
          </div>
        )}

        {lastError && !running && (
          <div className="alert err" style={{ marginTop: 8 }}>
            {lastError}
          </div>
        )}

        {!running && !lastError && (
          <div className="field-hint" style={{ marginTop: 8 }}>
            {t("overview.proxy.stoppedHint")}
          </div>
        )}
      </div>
    </section>
  );
}

/** 订阅健康: 总数 / 可用数 + 异常订阅明细。 */
function SubscriptionHealthCard({
  total,
  healthy,
  abnormal,
  loading,
  errorText,
}: {
  total: number;
  healthy: number;
  abnormal: SubscriptionDto[];
  loading: boolean;
  errorText: string | null;
}) {
  const { t } = useT();

  return (
    <section className={"stats-section" + (loading ? " is-loading" : "")} style={{ marginTop: 16 }}>
      <div className="stats-section-header stats-card-head">
        <div>
          <div className="stats-section-title">{t("overview.subs.title")}</div>
          <div className="stats-section-subtitle">
            {t("overview.subs.summary", {
              total: fmtNum(total),
              healthy: fmtNum(healthy),
              abnormal: fmtNum(abnormal.length),
            })}
          </div>
        </div>
      </div>
      <div className="stats-body">
        {errorText ? (
          <div className="field-hint stats-error">{errorText}</div>
        ) : total === 0 ? (
          <div className="field-hint">{t("overview.subs.empty")}</div>
        ) : abnormal.length === 0 ? (
          <div
            className="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--ok-bg)",
              borderColor: "var(--ok)",
            }}
          >
            <span className="status-dot status-dot-ok" aria-hidden />
            {t("overview.subs.allHealthy")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {abnormal.map((s) => (
              <AbnormalRow key={s.id} sub={s} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AbnormalRow({ sub }: { sub: SubscriptionDto }) {
  const { t } = useT();
  const reason = sub.last_error_message || stateLabel(sub.state, t);
  const cooldownLeft = sub.cooldown_until ? sub.cooldown_until - Date.now() : 0;
  const cooldownText =
    cooldownLeft > 0
      ? t("overview.subs.cooldown", { mins: Math.max(1, Math.ceil(cooldownLeft / 60000)) })
      : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
      }}
    >
      <ProviderLogo iconId={sub.provider_icon} size={28} iconSize={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
          {sub.display_name}
        </div>
        <div
          className="field-hint"
          style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={reason}
        >
          {reason}
        </div>
      </div>
      {cooldownText && (
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", flexShrink: 0 }}>
          {cooldownText}
        </span>
      )}
      <StatusBadge state={sub.state} />
    </div>
  );
}
