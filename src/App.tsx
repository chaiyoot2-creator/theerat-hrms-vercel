import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OnAuthSuccessPage from "./pages/OnAuthSuccessPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import CompanySettingsPage from "./pages/CompanySettingsPage";
import NotFound from "./pages/NotFound";
import { ErrorBoundary } from "react-error-boundary";
import { HelmetProvider } from "react-helmet-async";
import ErrorFallback from "./components/error-fallback";
import { CanonicalManager } from "./components/canonical-manager";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary 
    FallbackComponent={ErrorFallback}
    onError={(error, errorInfo) => {
      console.error(`Error Boundary caught an error(pathname:${location.pathname + location.search}):`, error, errorInfo);
      setTimeout(() => {
        throw error;
      }, 0);
    }}
  >
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <BrowserRouter>
            <Routes>
              <Route element={<CanonicalManager />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/onauthsuccess" element={<OnAuthSuccessPage />} />
                <Route path="/resetpassword" element={<ResetPasswordPage />} />
                <Route path="/company-settings" element={<CompanySettingsPage />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </HelmetProvider>
  </ErrorBoundary>
);

export default App;
