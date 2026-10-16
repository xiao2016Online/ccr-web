import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { I18nProvider } from "@/i18n";
import { WebAuthGate } from "@/components/layout/WebAuthGate";
import { SketchDefs } from "@/components/sketch/SketchDefs";
import { ThemeProvider } from "@/hooks/useTheme";
import { applyPlatformAttr } from "@/lib/platform";
import { runtime } from "@/runtime";
import "./fonts";
import "./styles.css";
// 主题样式必须排在 styles.css 之后: 同权重的覆盖靠源码顺序生效。
// plain.css 是「素净」画风的结构规则 (圆角/描边/布局), techblue.css 只含配色 token。
import "./themes/plain.css";
import "./themes/techblue.css";

// crypto.randomUUID 只在安全上下文 (HTTPS / localhost) 提供; 服务器版常以
// http://IP:端口 裸访问, 这里补一个 RFC 4122 v4 兜底实现 (Kiro OAuth 的
// PKCE 随机串等处会用到), 任何形态下都保证可用。
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

// 首帧前打平台标记: 拖窗带高度 / 窗口三键的排版靠 <html data-platform> 分流
applyPlatformAttr();

// web 模式用 HashRouter: pathname 永远是 /ui/, Vite base "./" 的相对资源路径在任何深链下都正确,
// Rust 侧不需要改写 index.html 也不需要 <base> 标签
const Router = runtime.kind === "web" ? HashRouter : BrowserRouter;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* 手绘抖动滤镜: 放在所有页面之外, 登录门禁 / 免责声明页里的 Logo 也能引用 */}
    <SketchDefs />
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <WebAuthGate>
            <Router>
              <App />
            </Router>
          </WebAuthGate>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
