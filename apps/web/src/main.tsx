import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { AppRouter } from "./app/router";
import { AuthProvider } from "./features/auth/auth-context";
import { LastEventProvider } from "./lib/lastEventContext";
import "./styles/theme.css";

registerSW({ immediate: true });

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LastEventProvider>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </LastEventProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
