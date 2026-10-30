import { createContext, useContext } from "react";

/** 第 5 步里 Claude Code 怎么接的, 给第 6 步摘要用; 只活在内存, 不进引导进度存档。 */
export type ClaudeOutcome = "written" | "manual" | null;

export const ConnectOutcomeContext = createContext<{
  claude: ClaudeOutcome;
  setClaude: (v: ClaudeOutcome) => void;
}>({ claude: null, setClaude: () => {} });

export function useConnectOutcome() {
  return useContext(ConnectOutcomeContext);
}
