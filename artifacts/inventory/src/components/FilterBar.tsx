import { useRef } from "react";
import { Search, X, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/DateRangePicker";
import { cn } from "@/lib/utils";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Typed definition for a single filter control auto-rendered inside the Filters popover. */
export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "daterange" | "boolean";
  /** Options for `type: "select"`. */
  options?: { value: string; label: string }[];
  /** URL key for the start date when `type: "daterange"`. Defaults to `"from"`. */
  fromKey?: string;
  /** URL key for the end date when `type: "daterange"`. Defaults to `"to"`. */
  toKey?: string;
}

/** Typed definition for a sort option auto-rendered inside the Filters popover. */
export interface SortDef {
  key: string;
  label: string;
}

export interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  // ── Typed filter API (auto-renders controls + chips + badge count) ──────────
  filterDefs?: FilterDef[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;

  // ── Typed sort API ──────────────────────────────────────────────────────────
  sortDefs?: SortDef[];
  sortValues?: { sortBy: string; sortDir: "asc" | "desc" };
  onSortChange?: (sortBy: string, sortDir: "asc" | "desc") => void;

  // ── Legacy / supplemental props ─────────────────────────────────────────────
  /** Custom JSX rendered at the bottom of the filter popover, below filterDefs. */
  filterContent?: React.ReactNode;
  /** Added to the auto-computed count (for items in filterContent not covered by filterDefs). */
  filterCount?: number;
  onReset?: () => void;
  /** Appended after auto-generated filterDef chips. */
  activeChips?: FilterChip[];

  rightSlot?: React.ReactNode;
  filterPopoverWidth?: string;
  className?: string;
  "data-testid"?: string;
}

function computeAutoChips(
  filterDefs: FilterDef[],
  filterValues: Record<string, string>,
  onFilterChange: (key: string, value: string) => void,
): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const def of filterDefs) {
    if (def.type === "select") {
      const val = filterValues[def.key] ?? "";
      if (val && val !== "all" && val !== "") {
        const option = def.options?.find((o) => o.value === val);
        chips.push({
          key: def.key,
          label: `${def.label}: ${option?.label ?? val}`,
          onRemove: () => onFilterChange(def.key, "all"),
        });
      }
    } else if (def.type === "boolean") {
      if (filterValues[def.key] === "true") {
        chips.push({
          key: def.key,
          label: def.label,
          onRemove: () => onFilterChange(def.key, "false"),
        });
      }
    } else if (def.type === "daterange") {
      const fk = def.fromKey ?? "from";
      const tk = def.toKey ?? "to";
      const from = filterValues[fk] ?? "";
      const to = filterValues[tk] ?? "";
      if (from || to) {
        chips.push({
          key: `${def.key}-daterange`,
          label:
            from && to
              ? `${from} – ${to}`
              : from
                ? `From ${from}`
                : `To ${to}`,
          onRemove: () => {
            onFilterChange(fk, "");
            onFilterChange(tk, "");
          },
        });
      }
    }
  }
  return chips;
}

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filterDefs,
  filterValues = {},
  onFilterChange,
  sortDefs,
  sortValues,
  onSortChange,
  filterContent,
  filterCount = 0,
  onReset,
  activeChips = [],
  rightSlot,
  filterPopoverWidth = "w-80",
  className,
  "data-testid": testId,
}: FilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-compute chips and count from filterDefs --------------------------------
  const autoChips =
    filterDefs && onFilterChange
      ? computeAutoChips(filterDefs, filterValues, onFilterChange)
      : [];

  const defaultSortKey = sortDefs?.[0]?.key;
  const sortIsActive =
    sortDefs &&
    sortValues &&
    (sortValues.sortBy !== defaultSortKey || sortValues.sortDir !== "desc");

  const sortChip: FilterChip | null =
    sortIsActive && onSortChange
      ? {
          key: "__sort__",
          label: `Sort: ${sortDefs!.find((s) => s.key === sortValues!.sortBy)?.label ?? sortValues!.sortBy} (${sortValues!.sortDir})`,
          onRemove: () => onSortChange(defaultSortKey!, "desc"),
        }
      : null;

  const allChips: FilterChip[] = [
    ...autoChips,
    ...(sortChip ? [sortChip] : []),
    ...activeChips,
  ];

  const autoCount = autoChips.length + (sortIsActive ? 1 : 0);
  const totalCount = filterDefs ? autoCount + filterCount : filterCount;

  const hasFilterPanel =
    (filterDefs && filterDefs.length > 0) ||
    filterContent ||
    (sortDefs && sortDefs.length > 0);

  return (
    <div
      className={cn("rounded-xl border border-border/60 bg-card p-3 space-y-2.5", className)}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {rightSlot}

        {hasFilterPanel && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 shrink-0"
                data-testid="btn-filters"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Filters</span>
                {totalCount > 0 && (
                  <Badge className="h-4 min-w-4 px-1 flex items-center justify-center text-[10px] rounded-full ml-0.5">
                    {totalCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className={cn("p-4", filterPopoverWidth)} align="end">
              <div className="space-y-4">
                {/* Auto-rendered filter controls from filterDefs */}
                {filterDefs?.map((def) => (
                  <div key={def.key} className="space-y-1.5">
                    {def.type !== "boolean" && (
                      <Label className="text-xs font-medium">{def.label}</Label>
                    )}
                    {def.type === "select" && (
                      <Select
                        value={filterValues[def.key] ?? "all"}
                        onValueChange={(v) => onFilterChange?.(def.key, v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {def.options?.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {def.type === "boolean" && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`fdef-${def.key}`}
                          checked={filterValues[def.key] === "true"}
                          onCheckedChange={(c) =>
                            onFilterChange?.(def.key, c ? "true" : "false")
                          }
                        />
                        <Label
                          htmlFor={`fdef-${def.key}`}
                          className="cursor-pointer text-sm font-normal"
                        >
                          {def.label}
                        </Label>
                      </div>
                    )}
                    {def.type === "daterange" && (
                      <DateRangePicker
                        from={filterValues[def.fromKey ?? "from"] ?? ""}
                        to={filterValues[def.toKey ?? "to"] ?? ""}
                        onChange={(f, t) => {
                          onFilterChange?.(def.fromKey ?? "from", f);
                          onFilterChange?.(def.toKey ?? "to", t);
                        }}
                        onClear={() => {
                          onFilterChange?.(def.fromKey ?? "from", "");
                          onFilterChange?.(def.toKey ?? "to", "");
                        }}
                        align="start"
                        placeholder="All dates"
                        className="w-full justify-start"
                      />
                    )}
                  </div>
                ))}

                {/* Auto-rendered sort controls */}
                {sortDefs && sortDefs.length > 0 && sortValues && onSortChange && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Sort by</Label>
                    <div className="flex items-center gap-1">
                      <Select
                        value={sortValues.sortBy}
                        onValueChange={(v) => onSortChange(v, sortValues.sortDir)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {sortDefs.map((s) => (
                            <SelectItem key={s.key} value={s.key}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() =>
                          onSortChange(
                            sortValues.sortBy,
                            sortValues.sortDir === "desc" ? "asc" : "desc",
                          )
                        }
                        title={
                          sortValues.sortDir === "desc"
                            ? "Switch to ascending"
                            : "Switch to descending"
                        }
                      >
                        <ArrowUpDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            sortValues.sortDir === "asc" && "rotate-180",
                          )}
                        />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Custom supplemental filter content */}
                {filterContent}

                {totalCount > 0 && onReset && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-8 text-xs gap-1 text-muted-foreground"
                    onClick={onReset}
                  >
                    <X className="h-3 w-3" />
                    Clear all filters
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {allChips.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5">
          {allChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 text-[11px] bg-muted border border-border rounded-full px-2.5 py-0.5 font-medium leading-none"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                className="text-muted-foreground hover:text-foreground transition-colors ml-0.5"
                aria-label={`Remove ${chip.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {totalCount > 0 && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
