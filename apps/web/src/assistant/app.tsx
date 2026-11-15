import { ThemeProvider } from 'next-themes';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AssistantSidebar } from './sidebar';
import { AutomationsPage } from './pages/automations';
import { ChatPage, HomePage } from './pages/chat';
import { LimitsPage } from './pages/limits';
import { RequirementsPage } from './pages/requirements';

export function AssistantApp() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter basename="/assistant">
          <SidebarProvider>
            <AssistantSidebar />
            <SidebarInset className="min-h-svh min-w-0">
              <Routes>
                <Route
                  index
                  element={<HomePage />}
                />
                <Route
                  path="c/:id"
                  element={<ChatPage />}
                />
                <Route
                  path="automations"
                  element={<AutomationsPage />}
                />
                <Route
                  path="limits"
                  element={<LimitsPage />}
                />
                <Route
                  path="requirements"
                  element={<RequirementsPage />}
                />
                <Route
                  path="*"
                  element={
                    <Navigate
                      to="/"
                      replace
                    />
                  }
                />
              </Routes>
            </SidebarInset>
          </SidebarProvider>
          <Toaster
            richColors
            position="top-center"
          />
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}
