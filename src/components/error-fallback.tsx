import React from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

interface ErrorFallbackProps {
  error?: Error;
  resetErrorBoundary?: () => void;
}

const ErrorFallback = ({ error, resetErrorBoundary }: ErrorFallbackProps) => {
  React.useEffect(() => {
    if (error) {
      window.dispatchEvent(new ErrorEvent('error', {
        error: error,
        message: error.message,
        filename: window.location.href,
        lineno: 0,
        colno: 0
      }));
    }
  }, [error]);

  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15 ring-2 ring-destructive/20">
            <AlertTriangle className="h-8 w-8 text-destructive drop-shadow-sm" />
          </div>
          <CardTitle className="text-xl font-semibold">Something went wrong</CardTitle>
          <CardDescription>
            Sorry, the application encountered an unexpected error
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-5 w-5" />
              <AlertDescription className="text-sm">
                <details className="mt-2">
                  <summary className="cursor-pointer font-medium">
                    Error Details
                  </summary>
                  <div id="capture-error-detail" className="mt-2 text-xs font-mono bg-muted/80 dark:bg-muted/20 p-3 rounded border dark:border-border/50 overflow-auto max-h-32 text-foreground dark:text-muted-foreground">
                    {error.message}
                  </div>
                </details>
              </AlertDescription>
            </Alert>
          )}

          <div className="text-sm text-muted-foreground text-center">
            You can try refreshing the page or returning to the homepage to resolve this issue
          </div>
        </CardContent>

        <Separator />

        <CardFooter className="flex flex-col gap-2 pt-6">
          <div className="flex w-full gap-2">
            {resetErrorBoundary && (
              <Button 
                onClick={resetErrorBoundary} 
                className="flex-1"
                variant="default"
              >
                <RefreshCw className="mr-2 h-4 w-4 opacity-90" />
                Retry
              </Button>
            )}
            <Button 
              onClick={handleReload} 
              variant="outline"
              className="flex-1"
            >
              <RefreshCw className="mr-2 h-4 w-4 opacity-90" />
              Refresh Page
            </Button>
          </div>
          
          <Button 
            onClick={handleGoHome} 
            variant="ghost"
            className="w-full"
          >
            <Home className="mr-2 h-4 w-4 opacity-80" />
            Go Home
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default ErrorFallback;
