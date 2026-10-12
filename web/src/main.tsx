import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth";
import { Layout } from "./components/Layout";
import "./index.css";
import { AccountsPage } from "./pages/AccountsPage";
import { AgentPage } from "./pages/AgentPage";
import { CampaignPage } from "./pages/CampaignPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { InvitesPage } from "./pages/InvitesPage";
import { LeadPage } from "./pages/LeadPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LoginPage } from "./pages/LoginPage";
import { NewCampaignPage } from "./pages/NewCampaignPage";
import { ReviewPage } from "./pages/ReviewPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/accounts" replace />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/new" element={<NewCampaignPage />} />
            <Route path="/campaigns/:id" element={<CampaignPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/leads/:id" element={<LeadPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/invites" element={<InvitesPage />} />
            <Route path="/agent" element={<AgentPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
