import { useRef } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filterContent?: React.ReactNode;
  filterCount?: number;
  onReset?: () => void;
  activeChips?: FilterChip[];
  rightSlot?: React.ReactNode;
  filterPopoverWidth?: string;
  className?: string;
  "data-testid"?: string;
}

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
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
              onClick={() => { onSearchChange(""); inputRef.current?.focus(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {rightSlot}

        {filterContent && (
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
                {filterCount > 0 && (
                  <Badge className="h-4 min-w-4 px-1 flex items-center justify-center text-[10px] rounded-full ml-0.5">
                    {filterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className={cn("p-4", filterPopoverWidth)} align="end">
              <div className="space-y-4">
                {filterContent}
                {filterCount > 0 && onReset && (
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

      {activeChips.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5">
          {activeChips.map((chip) => (
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
          {filterCount > 0 && onReset && (
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
