import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./app/router";
import { AuthProvider } from "./features/auth/auth-context";
import { LastEventProvider } from "./lib/lastEventContext";
import "./styles/theme.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LastEventProvider>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </LastEventProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
