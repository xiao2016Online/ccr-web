import { useEffect, useRef, useState } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/Spinner";
import { api } from "@/api/tauri";
import { useT, type TFunction } from "@/i18n";
import { cn } from "@/lib/utils";
import { fmtRelativeTime } from "@/lib/format";
import type {
  BalanceEntry,
  BalanceSeverity,
  SubscriptionDto,
} from "@/types";
import { errorText } from "@/lib/errorText";

interface Props {
  subscription: SubscriptionDto;
  /** Hook into refresh success — page-level invalidate keeps list badges in sync. */
  onChanged?: () => void;
}

/** provider yaml 没给 TTL 时的兜底, 与 Rust 侧 `default_balance_cache_ttl()` 一致。 */
const FALLBACK_TTL_MINUTES = 10;
/** 页面挂着不动时的探测间隔; 是否真的发请求取决于缓存有没有超过 TTL。 */
const RECHECK_INTERVAL_MS = 30_000;

/** 缓存保鲜期 (毫秒), 下限 1 分钟, 免得 TTL=0 变成"每次探测都重拉"。 */
function ttlMsOf(sub: SubscriptionDto): number {
  return Math.max(sub.balance_cache_ttl_minutes ?? FALLBACK_TTL_MINUTES, 1) * 60_000;
}

interface SeverityMeta {
  /** text color for the main number */
  text: string;
  /** background pill for the list-page badge */
  badge: string;
  /** i18n key for the inline label under the number; missing for `normal` */
  labelKey?: string;
}

const SEVERITY_META: Record<BalanceSeverity, SeverityMeta> = {
  normal: {
    text: "",
    badge: "bg-muted text-muted-foreground",
  },
  low: {
    text: "text-yellow-600 dark:text-yellow-400",
    badge: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-500",
    labelKey: "subscriptionBalance.severityLow",
  },
  critical: {
    text: "text-destructive",
    badge: "bg-destructive/10 text-destructive",
    labelKey: "subscriptionBalance.severityCritical",
  },
};

/**
 * 余额: 放在订阅编辑页「基本信息」卡片的右侧栏 (不再单独成卡)。
 * provider yaml 没声明余额查询时不渲染。
 *
 * 何时自动请求 (stale-while-revalidate, 一律静默 —— 期间照常显示旧值):
 * - 从没查过 (无缓存) → 进页面查一次, 按钮转圈;
 * - 进页面时缓存已超过 provider 的 `cache_ttl_minutes` → 静默重拉一次;
 * - 页面一直挂着 → 每 30 秒探一次, 一旦缓存过期就静默重拉 (切回标签页立刻再探);
 * - 缓存仍然新鲜 → 什么都不做, 直接用缓存 (避免每次打开页面都打 provider 的余额接口)。
 * 自动请求在每个 TTL 窗口内最多失败一次 (用 lastAttemptAt 退避, 不会每 30 秒重试)。
 * 手动点「刷新余额」永远真发请求, 不受 TTL 限制。
 */
export function SubscriptionBalancePanel({ subscription, onChanged }: Props) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  /** 静默重拉: 不转按钮, 只在脚注提示, 旧余额继续显示。 */
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 自动请求的在途标记, 防止定时器与挂载请求重叠。 */
  const autoInFlight = useRef(false);
  /** 最近一次请求的发起时刻 (失败也记), 让自动路径按 TTL 退避而不是每 30 秒重试。 */
  const lastAttemptAt = useRef(0);
  /** 定时器 / 可见性回调里读最新订阅, 避开闭包里的旧 props。 */
  const latest = useRef(subscription);

  useEffect(() => {
    latest.current = subscription;
  });

  const cache = subscription.balance_cache;

  // 进页面 (或换订阅) 时查一次: 没缓存就查, 过期就静默重拉。
  useEffect(() => {
    void autoRefreshIfStale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription.id]);

  // 页面一直挂着也到点自动更新: 定时探测 + 切回标签页立刻探测。
  useEffect(() => {
    if (!subscription.balance_supported) return;
    const tick = () => {
      // 后台标签页不探测, 浏览器恢复可见时由 visibilitychange 补一次。
      if (document.visibilityState !== "visible") return;
      void autoRefreshIfStale();
    };
    const timer = window.setInterval(tick, RECHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription.id, subscription.balance_supported]);

  if (!subscription.balance_supported) return null;

  /** 缓存过期 (或根本没有) 就静默拉一次; 同一 TTL 窗口内不重复尝试。 */
  async function autoRefreshIfStale() {
    const sub = latest.current;
    if (!sub.balance_supported || autoInFlight.current) return;
    const cached = sub.balance_cache;
    // 上一次尝试也算"刚看过": 失败后等一个 TTL 再来, 不每 30 秒打一次接口。
    const since = Math.max(cached?.fetched_at ?? 0, lastAttemptAt.current);
    if (Date.now() - since < ttlMsOf(sub)) return;
    autoInFlight.current = true;
    try {
      await doRefresh({ silent: !!cached });
    } finally {
      autoInFlight.current = false;
    }
  }

  async function doRefresh({ silent = false }: { silent?: boolean } = {}) {
    lastAttemptAt.current = Date.now();
    if (silent) setRevalidating(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await api.refreshSubscriptionBalance(subscription.id);
      if (result.kind === "success") {
        onChanged?.();
      } else if (result.kind === "failed") {
        setError(result.reason);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      if (silent) setRevalidating(false);
      else setLoading(false);
    }
  }

  const snapshot = cache?.snapshot;
  const accountUnavailable = snapshot?.is_available === false;

  return (
    <section className="balance-panel" aria-label={t("subscriptionBalance.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="h-4 w-4" />
          {t("subscriptionBalance.title")}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void doRefresh()}
          disabled={loading}
        >
          {loading ? <Spinner size={14} /> : <RefreshCw className="h-3.5 w-3.5" />}
          {loading
            ? t("subscriptionBalance.refreshing")
            : t("subscriptionBalance.refresh")}
        </Button>
      </div>
      <div className="space-y-2">
        {!snapshot && !error && !loading && (
          <div className="text-xs text-muted-foreground">
            {t("subscriptionBalance.neverFetched")}
          </div>
        )}

        {accountUnavailable && (
          <div className="text-xs text-destructive">
            {t("subscriptionBalance.accountUnavailable")}
          </div>
        )}

        {snapshot?.entries.map((entry, idx) => (
          <BalanceEntryRow
            key={`${entry.unit}-${idx}`}
            entry={entry}
            t={t}
            accountUnavailable={accountUnavailable}
          />
        ))}

        {error && (
          <div className="text-xs text-destructive">
            {t("subscriptionBalance.errPrefix")}
            {error}
          </div>
        )}

        {(cache || revalidating) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {revalidating && (
              <>
                <Spinner size={10} />
                <span>{t("subscriptionBalance.refreshing")}</span>
              </>
            )}
            {cache && (
              <span>
                {t("subscriptionBalance.lastUpdatedPrefix")}
                {fmtRelativeTime(cache.fetched_at, t)}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function BalanceEntryRow({
  entry,
  t,
  accountUnavailable,
}: {
  entry: BalanceEntry;
  t: TFunction;
  accountUnavailable: boolean;
}) {
  const effective = effectiveSeverity(entry.severity, accountUnavailable);
  const meta = SEVERITY_META[effective];
  const prefix = currencyPrefix(entry.unit);
  const { label, hint } = entryText(entry, t);

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-col items-end">
        <span className={cn("font-mono text-lg font-semibold tabular-nums", meta.text)}>
          {prefix}
          {entry.value_text}
          {!prefix && (
            <span className="ml-1 text-xs text-muted-foreground">{entry.unit}</span>
          )}
        </span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        {meta.labelKey && (
          <span className={cn("text-[11px]", meta.text)}>{t(meta.labelKey)}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Compact badge for the subscriptions list. Renders the first entry only;
 * returns null when no cache is available (the list page never auto-fetches).
 */
export function BalanceBadge({ subscription }: { subscription: SubscriptionDto }) {
  const { t } = useT();
  if (!subscription.balance_supported || !subscription.balance_cache) return null;

  const snapshot = subscription.balance_cache.snapshot;
  const entry = snapshot.entries[0];
  if (!entry) return null;

  const effective = effectiveSeverity(entry.severity, snapshot.is_available === false);
  const meta = SEVERITY_META[effective];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums",
        meta.badge,
      )}
      title={entryText(entry, t).hint}
    >
      {currencyPrefix(entry.unit) || `${entry.unit} `}
      {entry.value_text}
    </span>
  );
}

function effectiveSeverity(
  raw: BalanceSeverity,
  accountUnavailable: boolean,
): BalanceSeverity {
  return accountUnavailable ? "critical" : raw;
}

/** 按界面语言生成条目的标签与副标题; 老版本缓存没有 detail, 退回后端原文。 */
function entryText(entry: BalanceEntry, t: TFunction): { label: string; hint?: string } {
  const d = entry.detail;
  if (!d) return { label: entry.label, hint: entry.hint };
  const money = (amount: string) => `${currencyPrefix(entry.unit)}${amount}`;
  const label = t("subscriptionBalance.entry.label", { unit: entry.unit });
  switch (d.code) {
    case "topup_granted":
      return {
        label,
        hint: t("subscriptionBalance.entry.topupGranted", {
          toppedUp: money(d.topped_up),
          granted: money(d.granted),
        }),
      };
    case "topup_used":
      return {
        label,
        hint: t("subscriptionBalance.entry.topupUsed", {
          toppedUp: money(d.topped_up),
          used: money(d.used),
        }),
      };
  }
}

function currencyPrefix(unit: string): string {
  switch (unit) {
    case "CNY":
    case "JPY":
      return "¥";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    default:
      return "";
  }
}
