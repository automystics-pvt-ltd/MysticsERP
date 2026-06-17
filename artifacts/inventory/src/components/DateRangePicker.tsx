import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { CalendarDays, X } from "lucide-react";
import {
  format,
  parseISO,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfWeek,
  endOfQuarter,
  subQuarters,
  startOfQuarter,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { DateRange as DayPickerRange } from "react-day-picker";

export type DatePreset =
  | "today"
  | "last_7"
  | "last_30"
  | "this_month"
  | "last_month"
  | "this_week"
  | "last_quarter"
  | "custom";

export const PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  last_7: "Last 7 Days",
  last_30: "Last 30 Days",
  this_month: "This Month",
  last_month: "Last Month",
  this_week: "This Week",
  last_quarter: "Last Quarter",
  custom: "Custom range",
};

const DEFAULT_PRESETS: Exclude<DatePreset, "custom">[] = [
  "today",
  "last_7",
  "last_30",
  "this_month",
  "last_month",
];

function toISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function getPresetRange(
  preset: Exclude<DatePreset, "custom">,
): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (preset) {
    case "today":
      return { from: toISO(today), to: toISO(today) };
    case "last_7":
      return { from: toISO(subDays(today, 6)), to: toISO(today) };
    case "last_30":
      return { from: toISO(subDays(today, 29)), to: toISO(today) };
    case "this_month":
      return { from: toISO(startOfMonth(today)), to: toISO(today) };
    case "last_month": {
      const prev = subMonths(today, 1);
      return { from: toISO(startOfMonth(prev)), to: toISO(endOfMonth(prev)) };
    }
    case "this_week":
      return { from: toISO(startOfWeek(today, { weekStartsOn: 1 })), to: toISO(today) };
    case "last_quarter": {
      const prevQ = subQuarters(today, 1);
      return { from: toISO(startOfQuarter(prevQ)), to: toISO(endOfQuarter(prevQ)) };
    }
  }
}

export function detectPreset(from: string, to: string): DatePreset {
  const allPresets: Exclude<DatePreset, "custom">[] = [
    "today",
    "last_7",
    "last_30",
    "this_month",
    "last_month",
    "this_week",
    "last_quarter",
  ];
  for (const p of allPresets) {
    const r = getPresetRange(p);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

export function formatRangeLabel(from: string, to: string, placeholder?: string): string {
  if (!from && !to) return placeholder ?? "Date range";
  if (!from || !to) return from || to;
  const preset = detectPreset(from, to);
  if (preset !== "custom") return PRESET_LABELS[preset];
  const f = parseISO(from);
  const t = parseISO(to);
  if (from === to) return format(f, "d MMM yyyy");
  const sameYear = format(f, "yyyy") === format(t, "yyyy");
  return sameYear
    ? `${format(f, "d MMM")} – ${format(t, "d MMM yyyy")}`
    : `${format(f, "d MMM yyyy")} – ${format(t, "d MMM yyyy")}`;
}

export interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  onClear?: () => void;
  align?: "start" | "end" | "center";
  placeholder?: string;
  className?: string;
  /** Override which preset buttons appear (in order). Defaults to today/last_7/last_30/this_month/last_month. */
  presets?: Exclude<DatePreset, "custom">[];
}

export function DateRangePicker({
  from,
  to,
  onChange,
  onClear,
  align = "end",
  placeholder,
  className,
  presets = DEFAULT_PRESETS,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [customRange, setCustomRange] = useState<DayPickerRange | undefined>(() =>
    from && to ? { from: parseISO(from), to: parseISO(to) } : undefined,
  );

  // Keep calendar selection in sync when the parent clears or resets from/to.
  useEffect(() => {
    if (from && to) {
      setCustomRange({ from: parseISO(from), to: parseISO(to) });
    } else {
      setCustomRange(undefined);
    }
  }, [from, to]);

  const hasValue = !!from && !!to;
  const activePreset = hasValue ? detectPreset(from, to) : undefined;

  function handlePreset(p: Exclude<DatePreset, "custom">) {
    const r = getPresetRange(p);
    setCustomRange({ from: parseISO(r.from), to: parseISO(r.to) });
    onChange(r.from, r.to);
    setOpen(false);
  }

  function handleCustomSelect(selected: DayPickerRange | undefined) {
    setCustomRange(selected);
    if (selected?.from && selected?.to) {
      onChange(toISO(selected.from), toISO(selected.to));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5 text-xs font-medium px-3 max-w-[220px]",
            !hasValue && "text-muted-foreground",
            className,
          )}
          data-testid="btn-date-range-picker"
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{formatRangeLabel(from, to, placeholder)}</span>
          {hasValue && onClear && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date range"
              className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onClear?.();
                }
              }}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="flex">
          <div className="flex flex-col gap-0.5 border-r p-2 min-w-[130px]">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePreset(p)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors",
                  activePreset === p
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
            <div className="my-1 border-t" />
            <button
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors",
                activePreset === "custom"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {PRESET_LABELS.custom}
            </button>
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              selected={customRange}
              onSelect={handleCustomSelect}
              numberOfMonths={1}
              disabled={(date) => date > new Date()}
              initialFocus
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
