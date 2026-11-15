import { ThemeProvider } from 'next-themes';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppSidebar } from '@/components/app-sidebar';
import { Page } from '@/components/page';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { api, useLive } from '@/lib/api';
import { AssortmentPage } from '@/pages/assortment';
import { AuditPage } from '@/pages/audit';
import { ConnectPage } from '@/pages/connect';
import { MandatePage } from '@/pages/mandate';
import { ApprovalsPage, OrderDetailPage, OrdersPage } from '@/pages/orders';
import { OverviewPage } from '@/pages/overview';
import { SettingsPage } from '@/pages/settings';
import { StockPage } from '@/pages/stock';
import './index.css';

function Shell() {
  // The overview drives the sidebar badge and the dashboard; it polls so new agent activity shows up live.
  const { data: overview, refresh } = useLive(api.overview);
  const { data: info } = useLive(api.info, [], 60000);

  return (
    <SidebarProvider>
      <AppSidebar overview={overview} />
      <SidebarInset>
        <Routes>
          <Route
            index
            element={
              <OverviewPage
                overview={overview}
                refresh={refresh}
              />
            }
          />
          <Route
            path="approvals"
            element={<ApprovalsPage refreshShell={refresh} />}
          />
          <Route
            path="orders"
            element={<OrdersPage />}
          />
          <Route
            path="orders/:orderId"
            element={<OrderDetailPage refreshShell={refresh} />}
          />
          <Route
            path="stock"
            element={<StockPage />}
          />
          <Route
            path="assortment"
            element={<AssortmentPage />}
          />
          <Route
            path="agents"
            element={<ConnectPage />}
          />
          <Route
            path="rules"
            element={
              <MandatePage
                info={info}
                refreshShell={refresh}
              />
            }
          />
          <Route
            path="activity"
            element={<AuditPage />}
          />
          <Route
            path="settings"
            element={
              <SettingsPage
                info={info}
                refreshShell={refresh}
              />
            }
          />
          <Route
            path="connect"
            element={<Navigate to="/agents" replace />}
          />
          <Route
            path="mandate"
            element={<Navigate to="/rules" replace />}
          />
          <Route
            path="audit"
            element={<Navigate to="/activity" replace />}
          />
          <Route
            path="*"
            element={
              <Page title="Not found">
                <p className="text-muted-foreground">This page doesn’t exist.</p>
              </Page>
            }
          />
        </Routes>
      </SidebarInset>
    </SidebarProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange>
      <BrowserRouter basename="/app">
        <Shell />
        <Toaster
          richColors
          position="bottom-right"
        />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
