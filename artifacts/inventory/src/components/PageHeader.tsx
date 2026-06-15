import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  /** Breadcrumbs shown above the title */
  breadcrumbs?: Breadcrumb[];
  /** Link for a back-arrow button shown before the title */
  backHref?: string;
  /** Callback for a back-arrow button — use when navigating back via history instead of a fixed href */
  onBack?: () => void;
  /** Optional badge/pill shown inline after the title */
  badge?: ReactNode;
  /** Suppress the bottom border + margin (e.g. when used inside a card) */
  noBorder?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  breadcrumbs,
  backHref,
  onBack,
  badge,
  noBorder,
}: PageHeaderProps) {
  const hasBreadcrumbs = breadcrumbs && breadcrumbs.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 mb-8",
        !noBorder && "pb-5 border-b border-border/40",
        "sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {/* Breadcrumbs */}
        {hasBreadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
              {breadcrumbs.map((crumb, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3 opacity-50 shrink-0" />}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-foreground transition-colors truncate max-w-[120px]"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-foreground font-medium truncate max-w-[180px]">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        {/* Title row */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {(backHref || onBack) && (
            <Button
              variant="ghost"
              size="icon"
              {...(backHref ? { asChild: true } : { onClick: onBack })}
              className="h-8 w-8 shrink-0 -ml-1 text-muted-foreground hover:text-foreground"
              aria-label="Go back"
            >
              {backHref ? (
                <Link href={backHref}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              ) : (
                <ArrowLeft className="h-4 w-4" />
              )}
            </Button>
          )}
          <h1
            className="text-2xl font-bold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {title}
          </h1>
          {badge && (
            typeof badge === "string" ? (
              <Badge variant="secondary" className="text-xs font-medium">
                {badge}
              </Badge>
            ) : (
              badge
            )
          )}
        </div>

        {description && (
          <p
            className="text-sm text-muted-foreground mt-1.5"
            data-testid="text-page-description"
          >
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0 sm:ml-4">
          {actions}
        </div>
      )}
    </div>
  );
}
