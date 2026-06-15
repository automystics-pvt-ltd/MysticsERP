import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export type StatCardVariant = "default" | "success" | "warning" | "danger" | "info" | "purple";

const VARIANT_STYLES: Record<
  StatCardVariant,
  { icon: string; border: string; value: string; gradient?: boolean }
> = {
  default: {
    icon: "bg-gradient-to-br from-violet-100 to-violet-200/60 text-violet-700 dark:from-violet-900/50 dark:to-violet-800/30 dark:text-violet-400",
    border: "",
    value: "",
    gradient: false,
  },
  success: {
    icon: "bg-gradient-to-br from-emerald-100 to-emerald-200/60 text-emerald-700 dark:from-emerald-900/50 dark:to-emerald-800/30 dark:text-emerald-400",
    border: "border-emerald-200/60 dark:border-emerald-800/40",
    value: "text-emerald-700 dark:text-emerald-400",
  },
  warning: {
    icon: "bg-gradient-to-br from-amber-100 to-amber-200/60 text-amber-700 dark:from-amber-900/50 dark:to-amber-800/30 dark:text-amber-400",
    border: "border-amber-200/60 dark:border-amber-800/40",
    value: "text-amber-700 dark:text-amber-400",
  },
  danger: {
    icon: "bg-gradient-to-br from-red-100 to-red-200/60 text-red-700 dark:from-red-900/50 dark:to-red-800/30 dark:text-red-400",
    border: "border-red-200/60 dark:border-red-800/40",
    value: "text-red-700 dark:text-red-400",
  },
  info: {
    icon: "bg-gradient-to-br from-sky-100 to-sky-200/60 text-sky-700 dark:from-sky-900/50 dark:to-sky-800/30 dark:text-sky-400",
    border: "border-sky-200/60 dark:border-sky-800/40",
    value: "text-primary",
  },
  purple: {
    icon: "bg-gradient-to-br from-fuchsia-100 to-fuchsia-200/60 text-fuchsia-700 dark:from-fuchsia-900/50 dark:to-fuchsia-800/30 dark:text-fuchsia-400",
    border: "border-violet-200/60 dark:border-violet-800/40",
    value: "",
    gradient: true,
  },
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  description?: string;
  trend?: {
    value: number;
    label: string;
  };
  variant?: StatCardVariant;
  className?: string;
  href?: string;
}

export function StatCard({
  title,
  value,
  icon,
  description,
  trend,
  variant = "default",
  className,
}: StatCardProps) {
  const styles = VARIANT_STYLES[variant];
  const slug = title.replace(/\s+/g, "-").toLowerCase();

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all duration-200 hover:shadow-lg shadow-sm group border",
        styles.border || "border-card-border",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-4 px-5">
        <CardTitle
          className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground leading-none pt-0.5"
          data-testid={`text-stat-title-${slug}`}
        >
          {title}
        </CardTitle>
        {icon && (
          <div
            className={cn(
              "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-transform duration-200 group-hover:scale-110",
              styles.icon,
            )}
          >
            {icon}
          </div>
        )}
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div
          className={cn(
            "text-[30px] font-bold tracking-tight leading-none",
            styles.gradient ? "gradient-text-brand" : styles.value,
          )}
          data-testid={`text-stat-value-${slug}`}
        >
          {value}
        </div>
        {(description || trend) && (
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
            {trend && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-semibold",
                  trend.value > 0
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                    : trend.value < 0
                      ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {trend.value > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : trend.value < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                {trend.value > 0 ? "+" : ""}
                {trend.value}%
              </span>
            )}
            {trend?.label && (
              <span className="text-xs text-muted-foreground">{trend.label}</span>
            )}
            {!trend && description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
