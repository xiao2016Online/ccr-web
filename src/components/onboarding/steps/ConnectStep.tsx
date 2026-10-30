import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bot, Check, CircleAlert, Copy, Plug } from "lucide-react";
import ClaudeCode from "@lobehub/icons/es/ClaudeCode";
import Codex from "@lobehub/icons/es/Codex";
import HermesAgent from "@lobehub/icons/es/HermesAgent";
import OpenClaw from "@lobehub/icons/es/OpenClaw";
import OpenCode from "@lobehub/icons/es/OpenCode";
import { api } from "@/api/tauri";
import { runtime } from "@/runtime";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errorText";
import { buildRecommendedEnv, mergeRecommendedEnv } from "@/lib/recommendedClaudeCodeEnv";
import { buildRecommendedCodexAuth, buildRecommendedCodexConfig } from "@/lib/recommendedCodexConfig";
import { useProxyEndpoint } from "@/hooks/useSettings";
import { CLAUDE_CODE_SETTINGS_KEY, useApplyClaudeCodeSettings } from "@/hooks/useClaudeCodeSettings";
import { CopyableBlock } from "@/components/CopyableBlock";
import type { Wizard } from "../wizardStore";
import { useConnectOutcome } from "../connectOutcome";
import { useStepFooter } from "../stepFooter";

type ToolTab = "generic" | "claude-code" | "codex" | "more";

const ICON = 14;

/** 「更多工具」里的 id 与接入指南页的标签 id 一致, 点了直接跳过去。 */
const MORE_TOOLS: { id: string; name: string; icon: ReactNode }[] = [
  { id: "cc-switch", name: "cc-switch", icon: <Bot size={18} /> },
  { id: "openclaw", name: "OpenClaw", icon: <OpenClaw.Color size={18} /> },
  { id: "hermes", name: "Hermes Agent", icon: <HermesAgent size={18} /> },
  { id: "opencode", name: "OpenCode", icon: <OpenCode size={18} /> },
];

const ENDPOINTS: { label: string; path: string }[] = [
  { label: "Anthropic Messages", path: "/v1/messages" },
  { label: "OpenAI Responses", path: "/v1/responses" },
  { label: "Chat Completions", path: "/v1/chat/completions" },
];

const MODEL_NAMES = ["model-fable", "model-opus", "model-sonnet", "model-haiku"];

function maskToken(tok: string): string {
  return tok.length > 10 ? `${tok.slice(0, 4)}••••••••${tok.slice(-4)}` : "••••••••";
}

/** 第 5 步: 通用接入信息 + Claude Code / Codex 现成配置 + 去接入指南看其他工具。 */
export function ConnectStep({ wizard }: { wizard: Wizard }) {
  const { t } = useT();
  const [tab, setTab] = useState<ToolTab>("generic");
  useStepFooter({ canNext: true });
  const { port, baseUrl, token } = useProxyEndpoint();
  // 与接入指南同一兜底: base_url 未到时按设置的端口拼, 与 Rust local_base_url 同语义
  const base = baseUrl ?? `http://127.0.0.1:${port}`;

  const TABS: { id: ToolTab; label: string; icon: ReactNode }[] = [
    { id: "generic", label: t("guide.tab.generic"), icon: <Plug size={ICON} /> },
    { id: "claude-code", label: "Claude Code", icon: <ClaudeCode.Color size={ICON} /> },
    { id: "codex", label: "Codex", icon: <Codex size={ICON} /> },
    { id: "more", label: t("onboarding.wizard.connect.more"), icon: <ArrowRight size={ICON} /> },
  ];

  return (
    <div className="ob-stack">
      <div className="tabs ob-tabs" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            className={cn("tab", tab === x.id && "active")}
            onClick={() => setTab(x.id)}
          >
            {x.icon}
            {x.label}
          </button>
        ))}
      </div>
      {tab === "generic" && <GenericPanel base={base} token={token} />}
      {tab === "claude-code" && <ClaudePanel base={base} token={token} wizard={wizard} />}
      {tab === "codex" && <CodexPanel base={base} token={token} />}
      {tab === "more" && <MorePanel wizard={wizard} />}
    </div>
  );
}

function CopyRow({ label, shown, value }: { label: string; shown: string; value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await runtime.copyText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时不提示成功
    }
  }
  return (
    <div className="ob-copy-row">
      <span className="ob-copy-label">{label}</span>
      <code className="ob-copy-value">{shown}</code>
      <button type="button" className="ob-copy-btn" onClick={() => void copy()} aria-label={t("onboarding.wizard.connect.copy", { label })}>
        {copied ? <Check size={15} strokeWidth={2.4} className="ok" /> : <Copy size={15} />}
      </button>
    </div>
  );
}

function GenericPanel({ base, token }: { base: string; token: string }) {
  const { t } = useT();
  return (
    <div className="ob-stack">
      <div className="ob-copy-list">
        <CopyRow label="Base URL" shown={base} value={base} />
        <CopyRow label="API Key" shown={maskToken(token)} value={token} />
      </div>
      <span className="ob-h">{t("onboarding.wizard.connect.endpoints")}</span>
      <div className="ob-copy-list">
        {ENDPOINTS.map((e) => (
          <CopyRow key={e.path} label={e.label} shown={e.path} value={`${base}${e.path}`} />
        ))}
      </div>
      <div className="ob-chips">
        <span className="ob-h">{t("onboarding.wizard.connect.models")}</span>
        {MODEL_NAMES.map((m) => (
          <code key={m} className="ob-model-chip">{m}</code>
        ))}
      </div>
      <p className="field-hint">{t("onboarding.wizard.connect.genericNote")}</p>
    </div>
  );
}

function ClaudePanel({ base, token, wizard }: { base: string; token: string; wizard: Wizard }) {
  const { t } = useT();
  const qc = useQueryClient();
  const apply = useApplyClaudeCodeSettings();
  const { claude, setClaude } = useConnectOutcome();
  const [mode, setMode] = useState<"manual" | "auto">(claude === "written" ? "auto" : "manual");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; invalidJson: boolean } | null>(null);
  const navigate = useNavigate();
  const snap = { baseUrl: base, token };
  const json = JSON.stringify({ env: buildRecommendedEnv(snap) }, null, 2);

  async function copyManual() {
    setError(null);
    try {
      await runtime.copyText(json);
      setClaude("manual");
      setDone(t("onboarding.wizard.connect.claude.copied"));
    } catch (e) {
      setError({ text: errorText(e), invalidJson: false });
    }
  }

  async function writeAuto() {
    setBusy(true);
    setError(null);
    try {
      // 读最新的文件内容再合并 (用户可能刚在外部改过), 不用缓存
      const current = await qc.fetchQuery({
        queryKey: CLAUDE_CODE_SETTINGS_KEY,
        queryFn: () => api.readClaudeCodeSettings(),
        staleTime: 0,
      });
      const merged = mergeRecommendedEnv(current.content ?? "", snap);
      if (merged === null) {
        setError({ text: t("onboarding.wizard.connect.claude.invalidJson"), invalidJson: true });
        return;
      }
      const outcome = await apply.mutateAsync(merged);
      setClaude("written");
      setDone(
        outcome.backup_path
          ? t("onboarding.wizard.connect.claude.writtenBackup", { path: outcome.path, backup: outcome.backup_path })
          : t("onboarding.wizard.connect.claude.written", { path: outcome.path }),
      );
    } catch (e) {
      setError({ text: errorText(e), invalidJson: false });
    } finally {
      setBusy(false);
    }
  }

  const modes = [
    { id: "manual" as const, title: t("onboarding.wizard.connect.claude.manual"), sub: t("onboarding.wizard.connect.claude.manualSub"), rec: true },
    { id: "auto" as const, title: t("onboarding.wizard.connect.claude.auto"), sub: t("onboarding.wizard.connect.claude.autoSub"), rec: false },
  ];

  return (
    <div className="ob-stack">
      <div className="ob-mode-grid" role="radiogroup" aria-label="Claude Code">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={cn("ob-option ob-mode-card", mode === m.id && "selected")}
            onClick={() => {
              setMode(m.id);
              setDone(null);
              setError(null);
            }}
          >
            <span className="ob-mode-title">
              <span className="ob-radio" aria-hidden="true" />
              <span className="ob-option-name">{m.title}</span>
              {m.rec && <span className="ob-badge">{t("onboarding.wizard.connect.recommended")}</span>}
            </span>
            <span className="ob-option-sub">{m.sub}</span>
          </button>
        ))}
      </div>
      <CopyableBlock text={json} className="ob-code" />
      <div className="ob-test">
        {mode === "manual" ? (
          <button type="button" className="btn sm" onClick={() => void copyManual()}>
            <Copy size={13} /> {t("onboarding.wizard.connect.claude.copyBtn")}
          </button>
        ) : (
          <button type="button" className="btn sm" onClick={() => void writeAuto()} disabled={busy}>
            {busy ? t("onboarding.wizard.connect.claude.writing") : t("onboarding.wizard.connect.claude.writeBtn")}
          </button>
        )}
        {done && (
          <span className="ob-status ok">
            <Check size={13} strokeWidth={2.6} /> {done}
          </span>
        )}
      </div>
      {error && (
        <p className="ob-error" role="alert">
          <CircleAlert size={13} /> {error.text}{" "}
          {error.invalidJson && (
            <button
              type="button"
              className="ob-link"
              onClick={() => {
                // 编辑器在接入指南页: 窗口先收起, 否则页面换在窗口背后看不见
                wizard.dismiss();
                navigate("/guide?tab=claude-code");
              }}
            >
              {t("onboarding.wizard.connect.claude.openEditor")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function CodexPanel({ base, token }: { base: string; token: string }) {
  const { t } = useT();
  const snap = { baseUrl: base, token };
  return (
    <div className="ob-stack">
      <p className="ob-note">{t("onboarding.wizard.connect.codex.hint")}</p>
      <span className="ob-h">~/.codex/config.toml</span>
      <CopyableBlock text={buildRecommendedCodexConfig(snap, t("guide.codex.configComment")).trimEnd()} className="ob-code" />
      <span className="ob-h">~/.codex/auth.json</span>
      <CopyableBlock text={buildRecommendedCodexAuth(snap).trimEnd()} className="ob-code" />
      <p className="field-hint">{t("guide.codex.auth.note1")}</p>
    </div>
  );
}

function MorePanel({ wizard }: { wizard: Wizard }) {
  const { t } = useT();
  const navigate = useNavigate();
  return (
    <div className="ob-stack">
      <p className="ob-note">{t("onboarding.wizard.connect.moreIntro")}</p>
      {MORE_TOOLS.map((x) => (
        <button
          key={x.id}
          type="button"
          className="ob-option ob-more-row"
          onClick={() => {
            // 去接入指南看完整步骤; 窗口收起, 侧栏「继续设置」能回来
            wizard.dismiss();
            navigate(`/guide?tab=${x.id}`);
          }}
        >
          <span className="ob-more-icon" aria-hidden="true">{x.icon}</span>
          <span className="ob-option-name">{x.name}</span>
          <span className="ob-more-go">
            {t("onboarding.wizard.connect.openGuide")} <ArrowRight size={13} aria-hidden="true" />
          </span>
        </button>
      ))}
    </div>
  );
}
