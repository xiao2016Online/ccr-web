import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Eye, EyeOff, Lock, Search, Upload } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { runtime } from "@/runtime";
import { errorText } from "@/lib/errorText";
import { uniformSlots } from "@/lib/modelSlots";
import { canDiscardSubscription, inlineEndpoints, providerEntry } from "@/lib/onboardingFlow";
import { useProviders } from "@/hooks/useProviders";
import { useCreateSubscription, useDeleteSubscription, useSubscriptions } from "@/hooks/useSubscriptions";
import { ProviderLogo } from "@/components/ProviderLogo";
import { UrlParamFields, urlParamErrors } from "@/components/UrlParamFields";
import { ImportConfigDialog } from "@/routes/settings/ImportConfigDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ImportReport, ProviderInfo } from "@/types";
import type { Wizard } from "../wizardStore";
import { useStepFooter } from "../stepFooter";

const CUSTOM = "custom";

/**
 * 本步的表单草稿放在模块内存里: 进第 4 步再退回来不用重填 Key, 但刷新 / 重启就没了 ——
 * API Key 绝不写进 localStorage。fingerprint 记的是「上次创建订阅时的连接信息」, 没变就不重复创建。
 */
const draft = {
  providerId: "",
  endpointId: "",
  apiKey: "",
  urlParams: {} as Record<string, string>,
  fingerprint: "",
};

/** 第 3 步: 选厂商 + 填 Key。OAuth / 自定义跳完整添加页, 那边保存后回到窗口第 5 步。 */
export function SubscriptionStep({ wizard }: { wizard: Wizard }) {
  const { t } = useT();
  const navigate = useNavigate();
  const providers = useProviders();
  const subs = useSubscriptions();
  const createMut = useCreateSubscription();
  const deleteMut = useDeleteSubscription();
  const { state, patch, goTo } = wizard;

  const [query, setQuery] = useState("");
  const [providerId, setProviderIdState] = useState(draft.providerId);
  const [endpointId, setEndpointIdState] = useState(draft.endpointId);
  const [apiKey, setApiKeyState] = useState(draft.apiKey);
  const [urlParams, setUrlParamsState] = useState(draft.urlParams);
  const [showKey, setShowKey] = useState(false);
  const [showParamErrors, setShowParamErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [imported, setImported] = useState(false);

  const list = useMemo(
    () => (providers.data ?? []).filter((p) => providerEntry(p) !== "hidden"),
    [providers.data],
  );
  const q = query.trim().toLowerCase();
  const shown = q
    ? list.filter((p) => p.display_name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    : list;
  const provider = list.find((p) => p.id === providerId);
  const endpoints = provider ? inlineEndpoints(provider) : [];
  const endpoint = endpoints.find((e) => e.id === endpointId);

  async function pick(p: ProviderInfo | typeof CUSTOM) {
    if (p === CUSTOM || providerEntry(p) === "page") {
      // 改去完整添加页: 本窗口刚建、还没选模型的订阅就没用了, 先删掉免得留下 (pending) 订阅
      const existing = subs.data?.find((s) => s.id === state.subscriptionId);
      if (existing && canDiscardSubscription({ source: state.source, confirmed: state.confirmed })) {
        try {
          await deleteMut.mutateAsync(existing.id);
          draft.fingerprint = "";
          patch({ subscriptionId: null, source: null });
        } catch {
          // 删不掉也照样跳转, 用户可以在订阅页手动删
        }
      }
      navigate(`/subscriptions/new?onboarding=1&provider=${encodeURIComponent(p === CUSTOM ? CUSTOM : p.id)}`);
      return;
    }
    if (p.id === providerId) return;
    const eps = inlineEndpoints(p);
    const ep = eps.find((e) => e.id === p.default_endpoint) ?? eps[0];
    draft.providerId = p.id;
    draft.endpointId = ep?.id ?? "";
    draft.urlParams = {};
    // 一家的 Key 在另一家没用, 换厂商就清掉
    draft.apiKey = "";
    setProviderIdState(draft.providerId);
    setEndpointIdState(draft.endpointId);
    setUrlParamsState(draft.urlParams);
    setApiKeyState("");
    setShowParamErrors(false);
    setError(null);
  }

  function setEndpointId(v: string) {
    draft.endpointId = v;
    setEndpointIdState(v);
  }
  function setApiKey(v: string) {
    draft.apiKey = v;
    setApiKeyState(v);
    setError(null);
  }
  function setUrlParam(id: string, v: string) {
    draft.urlParams = { ...draft.urlParams, [id]: v };
    setUrlParamsState(draft.urlParams);
  }

  async function onNext(): Promise<boolean> {
    if (!provider || !endpoint || !apiKey.trim()) return false;
    if (Object.keys(urlParamErrors(provider, endpoint, urlParams)).length > 0) {
      setShowParamErrors(true);
      return false;
    }
    const params = Object.fromEntries(
      endpoint.url_params_used.map((id) => [id, (urlParams[id] ?? "").trim()]),
    );
    const fingerprint = JSON.stringify([provider.id, endpoint.id, apiKey.trim(), params]);
    const existing = subs.data?.find((s) => s.id === state.subscriptionId);
    if (existing && state.source === "wizard" && draft.fingerprint === fingerprint) return true;
    setError(null);
    try {
      if (existing && canDiscardSubscription({ source: state.source, confirmed: state.confirmed })) {
        await deleteMut.mutateAsync(existing.id);
      }
      const created = await createMut.mutateAsync({
        display_name: `${provider.display_name} ${Math.random().toString(36).slice(2, 8)}`,
        api_key: apiKey.trim(),
        // 占位槽: 第 4 步拉到模型列表后再写真实值 (同完整添加页的两步做法)
        model_slots: uniformSlots("(pending)"),
        source: { kind: "from_template", provider_id: provider.id, endpoint_id: endpoint.id, url_params: params },
      });
      draft.fingerprint = fingerprint;
      patch({ subscriptionId: created.id, source: "wizard", importedCount: null, confirmed: false });
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  useStepFooter({ canNext: !!provider && !!endpoint && apiKey.trim() !== "", onNext });

  async function onImported(report: ImportReport) {
    if (report.imported <= 0) return;
    // 备份里已有订阅与绑定: 本窗口刚建、还没确认的订阅就多余了
    const existing = subs.data?.find((x) => x.id === state.subscriptionId);
    if (existing && canDiscardSubscription({ source: state.source, confirmed: state.confirmed })) {
      try {
        await deleteMut.mutateAsync(existing.id);
      } catch {
        // 删不掉不影响导入结果, 用户可以在订阅页手动删
      }
    }
    draft.fingerprint = "";
    setImported(true);
    patch({ source: "import", importedCount: report.imported, subscriptionId: null, confirmed: false });
  }

  return (
    <div className="ob-stack">
      <label className="ob-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("onboarding.wizard.subscription.search", { n: list.length })}
          aria-label={t("onboarding.wizard.subscription.search", { n: list.length })}
        />
      </label>

      <div className="ob-provider-grid" role="list">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            aria-pressed={p.id === providerId}
            className={cn("ob-option ob-provider", p.id === providerId && "selected")}
            onClick={() => void pick(p)}
          >
            <ProviderLogo iconId={p.icon} size={28} />
            <span className="ob-provider-name">{p.display_name}</span>
            {providerEntry(p) === "page" && <span className="ob-provider-tag">{t("onboarding.wizard.subscription.oauth")}</span>}
          </button>
        ))}
        {!q && (
          <button type="button" role="listitem" className="ob-option ob-provider ob-provider-custom" onClick={() => void pick(CUSTOM)}>
            <span className="ob-provider-plus" aria-hidden="true">+</span>
            <span className="ob-provider-name">{t("onboarding.wizard.subscription.custom")}</span>
          </button>
        )}
        {q && shown.length === 0 && <p className="ob-empty">{t("onboarding.wizard.subscription.noMatch")}</p>}
      </div>

      {provider && endpoint && (
        <div className="ob-sub-form">
          <div className="ob-field">
            <span className="field-label">{t("onboarding.wizard.subscription.endpoint")}</span>
            <Select value={endpointId} onValueChange={setEndpointId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {endpoints.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="ob-field">
            <span className="field-label">API Key</span>
            <span className="ob-key">
              <input
                className="input mono"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t("onboarding.wizard.subscription.keyPlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="ob-key-eye"
                onClick={() => setShowKey((v) => !v)}
                aria-label={t(showKey ? "onboarding.wizard.subscription.hideKey" : "onboarding.wizard.subscription.showKey")}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          {endpoint.url_params_used.length > 0 && (
            <div className="ob-params">
              <UrlParamFields
                provider={provider}
                endpoint={endpoint}
                values={urlParams}
                onChange={setUrlParam}
                showErrors={showParamErrors}
              />
            </div>
          )}
          <div className="ob-key-hint">
            <span>
              <Lock size={12} aria-hidden="true" /> {t("onboarding.wizard.subscription.keyLocal")}
            </span>
            {provider.api_key_url && (
              <button
                type="button"
                className="ob-link"
                onClick={() => void runtime.openExternal(provider.api_key_url!).catch(() => {})}
              >
                {t("onboarding.wizard.subscription.getKey", { name: provider.display_name })} ↗
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="ob-error" role="alert">{error}</p>}

      <div className="ob-import">
        <button type="button" className="ob-link quiet" onClick={() => setImportOpen(true)}>
          <Upload size={14} aria-hidden="true" /> {t("onboarding.wizard.subscription.import")}
        </button>
      </div>

      <ImportConfigDialog
        open={importOpen}
        onOpenChange={(v) => {
          setImportOpen(v);
          // 关掉导入报告之后才前进, 让用户先看清哪些订阅被停用 / 跳过
          if (!v && imported) goTo("connect");
        }}
        onImported={(r) => void onImported(r)}
      />
    </div>
  );
}
