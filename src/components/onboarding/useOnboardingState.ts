import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/tauri";

export const ONBOARDING_STATE_KEY = ["onboarding-state"] as const;

/** DB 里的「引导是否已完成」, 只有引导窗口最后一步会改它, 所以不用轮询。 */
export function useOnboardingState() {
  return useQuery({
    queryKey: ONBOARDING_STATE_KEY,
    queryFn: () => api.getOnboardingState(),
    staleTime: Infinity,
  });
}
