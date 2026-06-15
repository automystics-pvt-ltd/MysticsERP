import { ShieldOff, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface AccessDeniedProps {
  message?: string;
  description?: string;
  showBack?: boolean;
}

export function AccessDenied({
  message = "Access Restricted",
  description = "You don't have permission to view this page. Contact your administrator to request access.",
  showBack = true,
}: AccessDeniedProps) {
  const [, navigate] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <ShieldOff className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-2 max-w-md">
        <h2 className="text-2xl font-semibold tracking-tight">{message}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </div>
      {showBack && (
        <Button
          variant="outline"
          onClick={() => navigate("/dashboard")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Go to Dashboard
        </Button>
      )}
    </div>
  );
}
