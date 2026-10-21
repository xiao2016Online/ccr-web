import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useT } from "@/i18n";

interface Props {
  total: number;
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  trailing?: React.ReactNode;
}

/**
 * 列表分页条: 首页 / 上一页 / [页码输入框] / 下一页 / 末页。
 * 页数多时逐页点太慢, 输入框支持直接跳转 (回车或失焦生效, 自动夹到合法范围)。
 */
export function Pagination({ total, page, totalPages, onChange, trailing }: Props) {
  const { t } = useT();
  const [draft, setDraft] = useState(String(page));

  // 外部翻页 (按钮 / 筛选条件变化重置) 时同步输入框显示
  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  if (total <= 0) return null;

  function commit() {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(page));
      return;
    }
    const target = Math.min(Math.max(1, n), Math.max(1, totalPages));
    setDraft(String(target));
    if (target !== page) onChange(target);
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 16,
        alignItems: "center",
      }}
    >
      <span
        className="mono"
        style={{ marginRight: "auto", fontSize: 12, color: "var(--ink-3)" }}
      >
        {t("requestLogs.summaryFormat", { total, page, pages: totalPages })}
      </span>
      {trailing}
      <button
        className="btn sm"
        disabled={page <= 1}
        onClick={() => onChange(1)}
        type="button"
        aria-label={t("requestLogs.firstPage")}
        title={t("requestLogs.firstPage")}
      >
        <ChevronsLeft size={13} />
      </button>
      <button
        className="btn sm"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
        type="button"
      >
        {t("requestLogs.prevPage")}
      </button>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <input
          className="input mono"
          type="number"
          inputMode="numeric"
          min={1}
          max={totalPages}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // 回车直接跳转; 阻止冒泡, 避免外层表单 (若有) 顺手提交
            if (e.key === "Enter" || e.keyCode === 13) {
              e.preventDefault();
              e.stopPropagation();
              commit();
            }
          }}
          aria-label={t("requestLogs.jumpToPage")}
          title={t("requestLogs.jumpToPage")}
          style={{ width: 64, textAlign: "center", padding: "4px 6px" }}
        />
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          / {totalPages}
        </span>
      </span>
      <button
        className="btn sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        type="button"
      >
        {t("requestLogs.nextPage")}
      </button>
      <button
        className="btn sm"
        disabled={page >= totalPages}
        onClick={() => onChange(totalPages)}
        type="button"
        aria-label={t("requestLogs.lastPage")}
        title={t("requestLogs.lastPage")}
      >
        <ChevronsRight size={13} />
      </button>
    </div>
  );
}
