import { createContext, useContext, useEffect } from "react";

/**
 * 步骤组件告诉窗口外壳「能不能下一步、下一步要做什么」。
 * onNext 返回 false = 留在本步 (校验没过 / 保存失败, 错误由步骤自己显示)。
 */
export interface StepFooter {
  canNext: boolean;
  onNext?: () => Promise<boolean>;
  nextLabel?: string;
}

/** 换步骤时先回到「不能下一步」, 直到新步骤上报自己的规则 —— 绝不沿用上一步的 onNext。 */
export const DEFAULT_FOOTER: StepFooter = { canNext: false };

export const StepFooterContext = createContext<(f: StepFooter) => void>(() => {});

/**
 * 每个步骤都必须调用 (不需要校验的步骤传 `{ canNext: true }`)。
 * 每次渲染都上报一次; 外壳只在 canNext / nextLabel 变化时重渲染, onNext 走 ref 取最新的闭包。
 */
export function useStepFooter(footer: StepFooter) {
  const set = useContext(StepFooterContext);
  useEffect(() => {
    set(footer);
  });
}
