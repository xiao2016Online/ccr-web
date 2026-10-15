import { useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw, Check, Copy } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Toggle } from "@/components/Toggle";
import { Spinner } from "@/components/Spinner";
import { api } from "@/api/tauri";
import { useGenerateNewToken } from "@/hooks/useSettings";
import { useT } from "@/i18n";
import { runtime } from "@/runtime";
import type { SettingsForm } from "./useSettingsForm";
import { errorText } from "@/lib/errorText";

/** 安全与访问: 鉴权 token / CORS. 网页界面与终端界面在「Web & TUI」标签 (WebTuiTab). */
export function AccessTab({ form }: { form: SettingsForm }) {
  const { t } = useT();
  const { settings } = form;
  const generateTokenMut = useGenerateNewToken();
  const [tokenJustRegenerated, setTokenJustRegenerated] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const regenerateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (regenerateTimerRef.current) clearTimeout(regenerateTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  async function copyToken() {
    if (!settings.data) return;
    try {
      await runtime.copyText(settings.data.auth_token);
    } catch {
      /* ignore: 与 CopyableBlock 一致, 剪贴板失败不打断 */
    }
    setTokenCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setTokenCopied(false), 1500);
  }

  async function regenerateToken() {
    try {
      await generateTokenMut.mutateAsync();
      setTokenJustRegenerated(true);
      if (regenerateTimerRef.current) clearTimeout(regenerateTimerRef.current);
      regenerateTimerRef.current = setTimeout(() => setTokenJustRegenerated(false), 2000);
    } catch (e) {
      alert(`${t("settings.auth.token.alertFailed")}: ${errorText(e)}`);
    }
  }

  return (
    <>
      {/* 鉴权与跨域 */}
      <div className="card section">
        <div className="card-head">
          <div className="card-title">{t("settings.section.auth")}</div>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div className="label-col">
              {t("settings.auth.token.label")}
              <div className="desc">{t("settings.auth.token.desc")}</div>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Toggle
                  checked={form.authEnabled}
                  onChange={(v) => void form.changeAuthEnabled(v)}
                  aria-label={t("settings.auth.token.label")}
                />
                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {form.authEnabled
                    ? t("settings.auth.token.enabled")
                    : t("settings.auth.token.disabled")}
                </span>
              </div>
              {form.authEnabled && settings.data && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input mono"
                    value={settings.data.auth_token}
                    readOnly
                    style={{ fontSize: 11.5, color: "var(--ink-2)" }}
                  />
                  <button className="btn" onClick={copyToken} type="button">
                    {tokenCopied ? (
                      <Check size={12} style={{ color: "var(--ok)" }} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {tokenCopied ? t("common.copied") : t("common.copy")}
                  </button>
                  <button
                    className="btn"
                    onClick={regenerateToken}
                    disabled={generateTokenMut.isPending}
                    type="button"
                  >
                    {generateTokenMut.isPending ? (
                      <Spinner />
                    ) : tokenJustRegenerated ? (
                      <Check size={12} style={{ color: "var(--ok)" }} />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    {tokenJustRegenerated
                      ? t("settings.auth.token.regenerated")
                      : t("settings.auth.token.regenerate")}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="setting-row">
            <div className="label-col">
              {t("settings.auth.cors.label")}
              <div className="desc">
                {form.corsEnabled
                  ? t("settings.auth.cors.descEnabled")
                  : t("settings.auth.cors.descDisabled")}
              </div>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Toggle
                  checked={form.corsEnabled}
                  onChange={(v) => void form.changeCorsEnabled(v)}
                  aria-label={t("settings.auth.cors.label")}
                />
                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {form.corsEnabled
                    ? t("settings.auth.cors.statusEnabled")
                    : t("settings.auth.cors.statusDisabled")}
                </span>
              </div>
              {form.corsEnabled && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="input mono"
                    value={form.corsAllowOrigin}
                    onChange={(e) => form.setCorsAllowOrigin(e.target.value)}
                    onBlur={() => {
                      if (
                        settings.data &&
                        form.corsAllowOrigin !== settings.data.cors_allow_origin
                      ) {
                        void form.changeCorsOrigin(form.corsAllowOrigin);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="*"
                    style={{ maxWidth: 280 }}
                  />
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
                    Access-Control-Allow-Origin
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AdminPasswordCard />
    </>
  );
}

/** 管理界面登录密码 (用户名 + 密码模式)。与上面的代理访问令牌是两套独立凭证。 */
function AdminPasswordCard() {
  const { t } = useT();
  const [username, setUsername] = useState("admin");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const okTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
    },
    [],
  );

  const mut = useMutation({
    mutationFn: () => api.changeAdminPassword(username.trim(), current, next),
    onSuccess: () => {
      setOk(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
      okTimerRef.current = setTimeout(() => setOk(false), 2500);
    },
    onError: (e) => setError(errorText(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError(t("settings.auth.admin.mismatch"));
      return;
    }
    mut.mutate();
  }

  const canSubmit = username.trim() && current && next.length >= 8 && !mut.isPending;

  return (
    <div className="card section">
      <div className="card-head">
        <div className="card-title">{t("settings.auth.admin.title")}</div>
      </div>
      <div className="card-body">
        <div className="setting-row">
          <div className="label-col">
            {t("settings.auth.admin.title")}
            <div className="desc">{t("settings.auth.admin.desc")}</div>
          </div>
          <form
            onSubmit={submit}
            style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}
          >
            <input
              className="input"
              type="text"
              autoComplete="username"
              spellCheck={false}
              placeholder={t("settings.auth.admin.username")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="input mono"
              type="password"
              autoComplete="current-password"
              placeholder={t("settings.auth.admin.currentPassword")}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <input
              className="input mono"
              type="password"
              autoComplete="new-password"
              placeholder={t("settings.auth.admin.newPassword")}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <input
              className="input mono"
              type="password"
              autoComplete="new-password"
              placeholder={t("settings.auth.admin.confirmPassword")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {error && (
              <div style={{ fontSize: 12, color: "var(--err)" }}>
                {t("settings.auth.admin.failed")}: {error}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn primary" type="submit" disabled={!canSubmit}>
                {mut.isPending ? (
                  <>
                    <Spinner />
                    {t("settings.auth.admin.submitting")}
                  </>
                ) : ok ? (
                  <>
                    <Check size={12} style={{ color: "var(--ok)" }} />
                    {t("settings.auth.admin.success")}
                  </>
                ) : (
                  t("settings.auth.admin.submit")
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
