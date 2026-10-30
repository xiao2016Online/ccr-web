import { api } from "@/api/tauri";
import type { EndpointProtocol, VirtualModelDto, VirtualModelName } from "@/types";

const CONVERSATION_VMS: readonly VirtualModelName[] = [
  "model-fable",
  "model-opus",
  "model-sonnet",
  "model-haiku",
  "model-fallback",
];

/**
 * 引导里新建的订阅并入虚拟模型, 让它马上能被调度: systemone 订阅只进 model-jev,
 * 其余进五个对话虚拟模型。保留各虚拟模型原有的调度模式与已绑定订阅 (追加在末尾、去重)。
 * 单个虚拟模型更新失败不影响其余 (allSettled) —— 用户随时可以在虚拟模型页补绑。
 */
export async function bindToConversationVirtualModels(
  subscriptionId: string,
  protocol: EndpointProtocol,
  current: VirtualModelDto[] | undefined,
): Promise<void> {
  const names: readonly VirtualModelName[] = protocol === "systemone" ? ["model-jev"] : CONVERSATION_VMS;
  await Promise.allSettled(
    names.map((name) => {
      const vm = current?.find((v) => v.name === name);
      const merged = Array.from(new Set([...(vm?.subscription_ids ?? []), subscriptionId]));
      return api.updateVirtualModel(name, {
        mode: vm?.mode ?? "sequential",
        subscription_ids: merged,
      });
    }),
  );
}
