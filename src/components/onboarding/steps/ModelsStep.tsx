import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert } from "lucide-react";
import { api } from "@/api/tauri";
import { runtime } from "@/runtime";
import { useT } from "@/i18n";
import { errorText } from "@/lib/errorText";
import { testResultText } from "@/lib/backendText";
import { MODEL_SLOT_KEYS, uniformSlots } from "@/lib/modelSlots";
import { bindToConversationVirtualModels } from "@/lib/bindVirtualModels";
import { providerName } from "@/lib/providerText";
import { useProviders } from "@/hooks/useProviders";
import { useSubscriptions, useUpdateSubscription } from "@/hooks/useSubscriptions";
import { useVirtualModels } from "@/hooks/useVirtualModels";
import { ModelSlotPicker } from "@/components/ModelSlotPicker";
import { Spinner } from "@/components/Spinner";
import type { ModelInfo, ModelSlots, RefreshModelListResult, SlotEfforts, TestConnectionResult } from "@/types";
import type { Wizard } from "../wizardStore";
import { useStepFooter } from "../stepFooter";

const PENDING = "(pending)";

function isPending(slots: ModelSlots): boolean {
  return MODEL_SLOT_KEYS.every((k) => slots[k] === PENDING);
}

/** 第 4 步: 拉模型列表, 给四个档位选模型; 下一步才写回订阅并并入虚拟模型。 */
export function ModelsStep({ wizard }: { wizard: Wizard }) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const subs = useSubscriptions();
  const providers = useProviders();
  const vms = useVirtualModels();
  const updateMut = useUpdateSubscription();
  const { state, goTo, patch } = wizard;
  const sub = subs.data?.find((s) => s.id === state.subscriptionId);
  const provider = providers.data?.find((p) => p.id === sub?.provider_id);
  const exampleModels = provider?.model_discovery.example_models ?? [];

  const [slots, setSlots] = useState<ModelSlots | null>(null);
  const [efforts, setEfforts] = useState<SlotEfforts>({});
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [test, setTest] = useState<{ busy: boolean; result: TestConnectionResult | null; error: string | null }>({
    busy: false,
    result: null,
    error: null,
  });

  // 订阅与厂商列表都到位后初始化一次本地草稿: 还是占位槽的先空着, 等模型列表回来再填。
  // 必须等厂商列表 —— 拉不到模型时要用厂商的示例模型兜底 (重启后直接落在本步时它可能还没加载完)
  const initedRef = useRef(false);
  useEffect(() => {
    if (!sub || !providers.data || initedRef.current) return;
    initedRef.current = true;
    setSlots(isPending(sub.model_slots) ? null : sub.model_slots);
    setEfforts(sub.slot_efforts ?? {});
    void refresh(isPending(sub.model_slots));
  }, [sub, providers.data]);

  async function refresh(fillPending: boolean) {
    if (!state.subscriptionId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const r: RefreshModelListResult = await runtime.invoke("refresh_model_list", { id: state.subscriptionId });
      if (r.kind === "auto") {
        setModels(r.models);
        if (fillPending) setSlots(uniformSlots(r.models[0]?.id ?? exampleModels[0] ?? ""));
      } else {
        setModels(null);
        setFetchError(r.reason);
        if (fillPending) setSlots(uniformSlots(exampleModels[0] ?? ""));
      }
    } catch (e) {
      setModels(null);
      setFetchError(errorText(e));
      if (fillPending) setSlots(uniformSlots(exampleModels[0] ?? ""));
    } finally {
      setLoading(false);
    }
  }

  async function save(): Promise<boolean> {
    if (!state.subscriptionId || !slots) return false;
    setSaveError(null);
    try {
      await updateMut.mutateAsync({ id: state.subscriptionId, patch: { model_slots: slots, slot_efforts: efforts } });
      return true;
    } catch (e) {
      setSaveError(errorText(e));
      return false;
    }
  }

  async function onNext(): Promise<boolean> {
    if (!state.subscriptionId) {
      goTo("subscription");
      return false;
    }
    if (!(await save())) return false;
    await bindToConversationVirtualModels(state.subscriptionId, sub?.endpoint_protocol ?? "messages", vms.data);
    // 定稿: 之后退回第 3 步换连接信息也不会再删它
    patch({ confirmed: true });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["virtual-models"] }),
      qc.invalidateQueries({ queryKey: ["subscriptions"] }),
    ]);
    return true;
  }

  async function runTest() {
    if (!state.subscriptionId) return;
    setTest({ busy: true, result: null, error: null });
    // 先保存: 测试用的是订阅里存着的槽位
    if (!(await save())) {
      setTest({ busy: false, result: null, error: null });
      return;
    }
    try {
      const result = await api.testConnection(state.subscriptionId);
      setTest({ busy: false, result, error: null });
    } catch (e) {
      setTest({ busy: false, result: null, error: errorText(e) });
    }
  }

  const filled = slots ? MODEL_SLOT_KEYS.some((k) => slots[k].trim() !== "" && slots[k] !== PENDING) : false;
  useStepFooter({ canNext: filled && !loading, onNext });

  if (!state.subscriptionId || (subs.isSuccess && !sub)) {
    return (
      <div className="ob-stack">
        <p className="ob-error" role="alert">{t("onboarding.wizard.models.missing")}</p>
        <div>
          <button type="button" className="btn sm" onClick={() => goTo("subscription")}>
            {t("onboarding.wizard.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-stack">
      {sub && models && (
        <span className="ob-status ok">
          <Check size={13} strokeWidth={2.6} aria-hidden="true" />
          {t("onboarding.wizard.models.fetched", { name: providerName(sub, locale), n: models.length })}
        </span>
      )}
      {slots ? (
        <ModelSlotPicker
          value={slots}
          onChange={(v) => {
            setSlots(v);
            setTest({ busy: false, result: null, error: null });
          }}
          efforts={efforts}
          onEffortsChange={setEfforts}
          effortDisabled={sub?.auth_type === "kiro_oauth"}
          effortDisabledReason={t("slotEffort.unsupportedKiro")}
          models={models}
          loading={loading}
          error={fetchError}
          onRefresh={() => void refresh(false)}
          exampleModels={exampleModels}
        />
      ) : (
        <div className="ob-loading">
          <Spinner size={14} /> {t("onboarding.wizard.models.loading")}
        </div>
      )}
      <p className="field-hint">{t("onboarding.wizard.models.emptyHint")}</p>
      <div className="ob-test">
        <button type="button" className="btn sm" onClick={() => void runTest()} disabled={!filled || test.busy}>
          {test.busy ? t("onboarding.wizard.models.testing") : t("onboarding.wizard.models.test")}
        </button>
        {test.result && (
          <span className={test.result.ok ? "ob-status ok" : "ob-status err"}>
            {test.result.ok ? <Check size={13} strokeWidth={2.6} /> : <CircleAlert size={13} />}
            {testResultText(test.result, t)}
          </span>
        )}
        {test.error && <span className="ob-status err">{test.error}</span>}
      </div>
      {saveError && <p className="ob-error" role="alert">{saveError}</p>}
    </div>
  );
}
