import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Render a smaller, inline variant (no min-height, less padding) */
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-xl",
        compact
          ? "py-8 px-6"
          : "py-16 px-8 min-h-[280px] border border-dashed border-border bg-muted/20",
        className,
      )}
      data-testid="empty-state"
    >
      {icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground mb-4",
            compact ? "h-12 w-12" : "h-16 w-16",
          )}
        >
          {icon}
        </div>
      )}

      <h3
        className={cn(
          "font-semibold text-foreground",
          compact ? "text-sm" : "text-base",
        )}
        data-testid="text-empty-title"
      >
        {title}
      </h3>
      <p
        className={cn(
          "text-muted-foreground max-w-xs mt-1.5",
          compact ? "text-xs" : "text-sm",
        )}
        data-testid="text-empty-description"
      >
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
