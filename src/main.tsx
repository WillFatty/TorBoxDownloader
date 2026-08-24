import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import "@fontsource-variable/outfit";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "@/app.css";

import { ActivityNotifier } from "@/components/ActivityNotifier";
import { LoginForm } from "@/components/LoginForm";
import { LibraryPage } from "@/components/LibraryPage";
import { LogsPage } from "@/components/LogsPage";
import { SearchWorkspace } from "@/components/SearchWorkspace";
import { SettingsForm } from "@/components/SettingsForm";
import { SiteNav } from "@/components/SiteNav";

function AppLayout() {
  return (
    <div className="app-frame">
      <SiteNav />
      <main className="app-main">
        <Outlet />
      </main>
      <ActivityNotifier />
    </div>
  );
}

function LoginLayout() {
  return <LoginForm />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginLayout />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<SearchWorkspace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsForm />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
