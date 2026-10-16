import { useMemo, useState } from "react";
import { Check, Copy, Plus, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { ProviderLogo } from "@/components/ProviderLogo";
import { SortableSubscriptionList } from "@/components/SortableSubscriptionList";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { useProxyStatus } from "@/hooks/useSettings";
import { useVirtualModels, useUpdateVirtualModel } from "@/hooks/useVirtualModels";
import { isAnthropicPassthrough } from "@/lib/authTypes";
import { customProviderLabel } from "@/lib/providerLabels";
import { providerName as localProviderName } from "@/lib/providerText";
import { VM_META, VM_ORDER, isJev, jevModelOf, vmAccepts, vmNameToSlot } from "@/lib/virtualModels";
import { runtime } from "@/runtime";
import { useT } from "@/i18n";
import type {
  RoutingMode,
  SubscriptionDto,
  SubscriptionSlot,
  VirtualModelDto,
  VirtualModelName,
} from "@/types";

export function VirtualModelsPage() {
  const { t } = useT();
  const subs = useSubscriptions();
  const vms = useVirtualModels();

  const subsMap = useMemo(() => {
    const m = new Map<string, SubscriptionDto>();
    subs.data?.forEach((s) => m.set(s.id, s));
    return m;
  }, [subs.data]);

  const orderedVms = useMemo<VirtualModelDto[]>(
    () =>
      VM_ORDER.map((name) => vms.data?.find((v) => v.name === name)).filter(
        (v): v is VirtualModelDto => v !== undefined,
      ),
    [vms.data],
  );

  return (
    <>
      <div className="page-actions">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>{t("virtualModels.title")}</h1>
          <div className="subtitle">
            {t("virtualModels.subtitle1")}
            <span className="mono" style={{ color: "var(--ink-2)" }}> model-fallback</span>
            {t("virtualModels.subtitle2")}
          </div>
        </div>
        {/* 手写批注: 指向下方可拖拽排序的订阅行 */}
        <div className="hand-note" aria-hidden="true">
          <span>{t("virtualModels.dragHint")}</span>
          <svg viewBox="0 0 40 40" width="32" height="32">
            <path d="M6 6 C 22 6, 32 14, 30 32 M23 26 L30 33 L36 25" />
          </svg>
        </div>
      </div>

      <div className="slot-grid">
        {orderedVms.map((vm) => (
          <VirtualModelCard
            key={vm.name}
            vm={vm}
            subsMap={subsMap}
            allSubs={subs.data ?? []}
          />
        ))}
      </div>

    </>
  );
}

function VirtualModelCard({
  vm,
  subsMap,
  allSubs,
}: {
  vm: VirtualModelDto;
  subsMap: Map<string, SubscriptionDto>;
  allSubs: SubscriptionDto[];
}) {
  const { t } = useT();
  const updateMut = useUpdateVirtualModel();
  const [pickerOpen, setPickerOpen] = useState(false);
  const meta = VM_META[vm.name];

  function update(mode: RoutingMode, subscription_ids: string[]) {
    updateMut.mutate({ name: vm.name, input: { mode, subscription_ids } });
  }
  function onReorder(ids: string[]) {
    update(vm.mode, ids);
  }
  function onRemove(id: string) {
    update(vm.mode, vm.subscription_ids.filter((x) => x !== id));
  }
  function addSubs(ids: string[]) {
    const existing = new Set(vm.subscription_ids);
    const merged = [...vm.subscription_ids, ...ids.filter((id) => !existing.has(id))];
    update(vm.mode, merged);
  }

  const slot = vmNameToSlot(vm.name);
  const modeHint =
    vm.mode === "round_robin"
      ? t("virtualModels.mode.roundRobinHint")
      : vm.mode === "sticky"
        ? t("virtualModels.mode.stickyHint")
        : t("virtualModels.mode.sequentialHint");
  // fallback 是第 5 个虚拟模型, 语义上与 4 个槽位并列而非同级, 通栏独占一行
  const isFallback = vm.name === "model-fallback";
  const jev = isJev(vm.name);

  return (
    <div className={jev ? "slot-card wide jev" : isFallback ? "slot-card wide" : "slot-card"}>
      {jev && (
        <div className="jev-hangtag" aria-hidden="true">
          <span className="jev-hangtag-string" />
          <span className="jev-hangtag-tag">
            JEV
            <small>{t("virtualModels.jev.tagSub")}</small>
          </span>
        </div>
      )}
      <div className="slot-head compact">
        <div style={{ minWidth: 0 }}>
          <span className="slot-name">{vm.name}</span>
          <span className="slot-purpose">
            <strong>{t(meta.purposeKey)}</strong> · {t(meta.purposeEnKey)}
          </span>
        </div>
        <div className="radio-group sm" title={modeHint}>
          <button
            className={vm.mode === "sequential" ? "on" : ""}
            onClick={() => update("sequential", vm.subscription_ids)}
            type="button"
          >
            {t("vm.mode.sequential")}
          </button>
          <button
            className={vm.mode === "round_robin" ? "on" : ""}
            onClick={() => update("round_robin", vm.subscription_ids)}
            type="button"
          >
            {t("vm.mode.round_robin")}
          </button>
          <button
            className={vm.mode === "sticky" ? "on" : ""}
            onClick={() => update("sticky", vm.subscription_ids)}
            type="button"
          >
            {t("vm.mode.sticky")}
          </button>
        </div>
      </div>

      <div className="slot-body">
        <SortableSubscriptionList
          subscriptionIds={vm.subscription_ids}
          subscriptions={subsMap}
          slot={slot}
          vmName={vm.name}
          onChange={onReorder}
          onRemove={onRemove}
        />

        <button
          className="add-endpoint compact"
          onClick={() => setPickerOpen(true)}
          type="button"
        >
          <Plus size={12} /> {t("virtualModels.addButtonShort")}
        </button>
        {jev && <JevAccessHint />}
      </div>

      <AddSubscriptionDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        existingIds={vm.subscription_ids}
        allSubs={allSubs}
        vmName={vm.name}
        slot={slot}
        isFallback={isFallback}
        onConfirm={(ids) => {
          addSubs(ids);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

/** 候选多于这个数才显示搜索框 */
const PICKER_SEARCH_THRESHOLD = 6;

/** base_url → 主机名; 解析失败原样返回。用来区分同一厂商下接了不同地址的订阅 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function AddSubscriptionDialog({
  open,
  onOpenChange,
  existingIds,
  allSubs,
  vmName,
  slot,
  isFallback,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingIds: string[];
  allSubs: SubscriptionDto[];
  vmName: VirtualModelName;
  /** null = fallback 卡片, 订阅走兜底槽或原样透传 */
  slot: SubscriptionSlot | null;
  /** fallback 卡片打开时 true: 对「翻译类且未配兜底槽」的候选显示提示 (不禁选) */
  isFallback: boolean;
  onConfirm: (ids: string[]) => void;
}) {
  const { t, locale } = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const candidates = allSubs.filter(
    (s) => s.enabled && !existingIds.includes(s.id) && vmAccepts(vmName, s.endpoint_protocol),
  );

  const providerName = (sub: SubscriptionDto) =>
    customProviderLabel(sub.provider_id, t) ?? localProviderName(sub, locale);
  // 与 SortableSubscriptionList 同一套规则: 加进来之后这条订阅在本卡片里实际会用的模型
  const modelFor = (sub: SubscriptionDto) => {
    if (isJev(vmName)) return jevModelOf(sub) ?? t("sortableSub.passthrough");
    if (slot !== null) return sub.model_slots[slot] || "—";
    return sub.model_slots.fallback?.trim() || t("sortableSub.passthrough");
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? candidates.filter((sub) =>
        [sub.display_name, providerName(sub), hostOf(sub.base_url), modelFor(sub), sub.oauth_account?.email ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : candidates;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setSelected(new Set());
          setQuery("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="cc-dialog" style={{ maxWidth: 680, width: "92vw" }}>
        <DialogHeader>
          <DialogTitle>{t("virtualModels.dialog.title")}</DialogTitle>
          <div className="pick-target">
            {t("virtualModels.dialog.target")} <span className="mono">{vmName}</span>
          </div>
        </DialogHeader>
        {candidates.length === 0 ? (
          <div className="field-hint">
            {isJev(vmName) ? t("virtualModels.dialog.emptyJev") : t("virtualModels.dialog.empty")}
          </div>
        ) : (
          <>
            {candidates.length > PICKER_SEARCH_THRESHOLD && (
              <label className="pick-search">
                <Search size={14} aria-hidden />
                <input
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("virtualModels.dialog.search")}
                  aria-label={t("virtualModels.dialog.search")}
                />
              </label>
            )}
            <div className="pick-list">
              {visible.map((sub) => {
                const on = selected.has(sub.id);
                const host = hostOf(sub.base_url);
                const needFallback =
                  isFallback && !sub.model_slots.fallback?.trim() && !isAnthropicPassthrough(sub.auth_type);
                return (
                  <label key={sub.id} className={on ? "pick-row on" : "pick-row"}>
                    <input
                      type="checkbox"
                      className="pick-check-input"
                      checked={on}
                      onChange={() => toggle(sub.id)}
                    />
                    <span className="pick-check" aria-hidden>
                      {on && <Check size={12} strokeWidth={3} />}
                    </span>
                    <ProviderLogo iconId={sub.provider_icon} size={32} iconSize={20} />
                    <span className="pick-main">
                      <span className="pick-name">
                        {sub.display_name}
                        <StatusBadge state={sub.state} />
                        {needFallback && (
                          <span className="pill warn">{t("virtualModels.dialog.needFallbackSlot")}</span>
                        )}
                      </span>
                      <span className="pick-meta">
                        {providerName(sub)}
                        <span className="pick-sep">·</span>
                        <span className="mono">{sub.oauth_account?.email ?? host}</span>
                      </span>
                    </span>
                    <span className="pick-side">
                      <span className="pick-label">{t("virtualModels.dialog.slotModel")}</span>
                      <span className="pick-model mono" title={modelFor(sub)}>
                        {modelFor(sub)}
                      </span>
                      <span className="pick-used">
                        {sub.referenced_by.length > 0 ? (
                          <>
                            {t("virtualModels.dialog.usedBy")}{" "}
                            {sub.referenced_by.map((n) => (
                              <span key={n} className="pill tag mono">
                                {n.replace("model-", "")}
                              </span>
                            ))}
                          </>
                        ) : (
                          t("virtualModels.dialog.unused")
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
              {visible.length === 0 && <div className="field-hint">{t("virtualModels.dialog.noMatch")}</div>}
            </div>
          </>
        )}
        <DialogFooter className="pick-footer">
          {selected.size > 0 && (
            <span className="pick-count">{t("virtualModels.dialog.selectedCount", { count: selected.size })}</span>
          )}
          <button className="btn" onClick={() => onOpenChange(false)} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="btn primary"
            disabled={selected.size === 0}
            onClick={() => onConfirm(Array.from(selected))}
            type="button"
          >
            {t("virtualModels.dialog.add")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * jev 卡片底部的接入示例: 调用方是用户自己的代码, 没有 CC 那样现成的环境变量片段。
 * model 写虚拟名 model-jev, 后端按每条订阅的 Jev 槽 / 端点示例模型改写, 所以对任何上游都能直接用。
 */
function JevAccessHint() {
  const { t } = useT();
  const status = useProxyStatus();
  const [copied, setCopied] = useState(false);
  const base = status.data?.base_url ?? "http://127.0.0.1:23456";
  const curl = [
    `curl ${base}/v1/systemone \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Authorization: Bearer <cc-router token>" \\`,
    `  -d '{"model":"model-jev","state":"Hello World","questions":{"says_hello":{"type":"noul","instructions":"Does the state text contain a greeting?"}}}'`,
  ].join("\n");
  return (
    <div className="jev-access">
      <b>{t("virtualModels.jev.access")}</b>
      <span className="mono">{base}/v1/systemone</span>
      <span>{t("virtualModels.jev.keyHint")}</span>
      <button
        type="button"
        className="jev-copy"
        onClick={() => {
          runtime
            .copyText(curl)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
      >
        <Copy size={11} /> {copied ? t("virtualModels.jev.copied") : t("virtualModels.jev.copyCurl")}
      </button>
    </div>
  );
}
