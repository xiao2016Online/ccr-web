import type { CSSProperties } from "react";

/**
 * cc-router 的 Logo: 科技蓝的「C 环 · 数据流」。
 *
 * 左侧一个开口圆环 (取 cc-router 的 C), 开口处三枚数据节点由浅到深,
 * 表示「一个端点后面挂着多条上游」。纯矢量, 任意尺寸清晰:
 * - 28px 侧栏 / 16px 浏览器标签页都能辨出环形轮廓;
 * - mono 时全部走 currentColor, 用于托盘等单色场景;
 * - tile 时画在圆角底板上 (登录页 / 关于页大图)。
 *
 * 原手绘小猪 (像素版 + 描线版) 已不再使用, 保留 assets/logo-classic.png
 * 仅为兼容旧缓存, 组件不再引用。
 */
interface Props {
  size: number;
  /** 保留参数以兼容旧调用方; 新 Logo 无画风差异, 不再使用 */
  plainSize?: number;
  variant?: "full" | "compact";
  tile?: boolean;
  mono?: boolean;
  className?: string;
  /** 默认作为装饰隐藏; 独立出现 (无旁白文字) 时传入可读名称 */
  label?: string;
}

/** 开口环: 圆心 (24,24), 半径 14, 缺口朝右 120°。 */
const RING = "M31 11.88 A14 14 0 1 0 31 36.12";

/** 缺口处的三枚节点, 由浅到深。颜色跟随主题强调色, 明暗模式自动适配。 */
const NODES = [
  { cx: 31.2, cy: 10.6, r: 4.6, tone: "color-mix(in srgb, var(--accent) 52%, #ffffff)" },
  { cx: 33.6, cy: 24, r: 5.2, tone: "var(--accent)" },
  { cx: 31.2, cy: 37.4, r: 4.6, tone: "color-mix(in srgb, var(--accent) 74%, #ffffff)" },
] as const;

const RING_COLOR = "var(--accent)";

export function LogoMark({ size, variant = "full", tile = false, className, label, mono = false }: Props) {
  // 旧调用方传的 plainSize 只对已废弃的像素 Logo 有意义, 新 Logo 统一按 size 渲染
  const box = size;
  const compact = variant === "compact" || size <= 40;
  const ringWidth = compact ? 7 : 5.6;
  const tilePad = Math.round(box * (compact ? 0.12 : 0.1));

  const svg = (
    <svg
      viewBox="0 0 48 48"
      width="100%"
      height="100%"
      role={label && !tile ? "img" : undefined}
      aria-label={label && !tile ? label : undefined}
      aria-hidden={label && !tile ? undefined : true}
      focusable="false"
      style={{ display: "block", overflow: "visible" }}
    >
      <path
        d={RING}
        fill="none"
        stroke={mono ? "currentColor" : RING_COLOR}
        strokeWidth={ringWidth}
        strokeLinecap="round"
      />
      {NODES.map((n, i) => (
        <circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r={compact ? n.r + 0.4 : n.r}
          fill={mono ? "currentColor" : n.tone}
        />
      ))}
    </svg>
  );

  if (!tile) {
    return (
      <span
        className={className}
        style={{ display: "inline-block", width: box, height: box, flexShrink: 0, lineHeight: 0 }}
      >
        {svg}
      </span>
    );
  }

  // tile: 圆角底板上放 logo (登录页 / 关于页的大图)
  const tileStyle: CSSProperties = {
    width: box,
    height: box,
    padding: tilePad,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Math.round(box * 0.24),
    background: mono ? "transparent" : "var(--surface)",
    boxShadow: mono ? undefined : "0 1px 3px rgba(15, 23, 42, 0.10)",
    flexShrink: 0,
    lineHeight: 0,
  };
  return (
    <span
      className={className ? `logo-tile ${className}` : "logo-tile"}
      role={label ? "img" : undefined}
      aria-label={label}
      style={tileStyle}
    >
      {svg}
    </span>
  );
}
