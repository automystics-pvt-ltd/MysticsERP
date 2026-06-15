import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TablePaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "...", total];
  if (current >= total - 3) return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
}

export function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  itemLabel = "items",
  className,
  pageSizeOptions,
  onPageSizeChange,
}: TablePaginationProps) {
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);
  const pages = getPageNumbers(page, totalPages);

  const pageSizeSelector = pageSizeOptions && onPageSizeChange ? (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="hidden sm:inline">Rows</span>
      <Select
        value={String(pageSize)}
        onValueChange={(v) => {
          onPageSizeChange(Number(v));
          onPageChange(1);
        }}
      >
        <SelectTrigger className="h-7 w-[62px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pageSizeOptions.map((o) => (
            <SelectItem key={o} value={String(o)} className="text-xs">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  if (totalPages <= 1 && !pageSizeSelector) {
    return (
      <div className={cn("flex items-center justify-between pt-3 px-1 mt-1 border-t border-border/40", className)}>
        <p className="text-xs text-muted-foreground">
          {total} {itemLabel}
        </p>
        <span />
      </div>
    );
  }

  if (totalPages <= 1 && pageSizeSelector) {
    return (
      <div className={cn("flex items-center justify-between pt-3 px-1 mt-1 border-t border-border/40", className)}>
        <p className="text-xs text-muted-foreground">
          {total} {itemLabel}
        </p>
        {pageSizeSelector}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 px-1 mt-1 border-t border-border/40", className)}>
      {/* Left: count label + optional page-size selector */}
      <div className="flex items-center gap-3 order-2 sm:order-1">
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-medium text-foreground">{start}–{end}</span> of{" "}
          <span className="font-medium text-foreground">{total.toLocaleString()}</span> {itemLabel}
        </p>
        {pageSizeSelector}
      </div>

      {/* Page controls */}
      <div className="flex items-center gap-1 order-1 sm:order-2">
        {/* First */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 hidden sm:flex"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          aria-label="First page"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>

        {/* Previous */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Page numbers */}
        <div className="flex items-center gap-1">
          {pages.map((p, i) =>
            p === "..." ? (
              <span
                key={`ellipsis-${i}`}
                className="h-8 w-8 flex items-center justify-center text-xs text-muted-foreground select-none"
              >
                ⋯
              </span>
            ) : (
              <Button
                key={p}
                variant={page === p ? "default" : "ghost"}
                size="icon"
                className={cn(
                  "h-8 w-8 text-xs font-medium",
                  page === p
                    ? "shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onPageChange(p as number)}
                aria-label={`Page ${p}`}
                aria-current={page === p ? "page" : undefined}
              >
                {p}
              </Button>
            ),
          )}
        </div>

        {/* Next */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Last */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 hidden sm:flex"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          aria-label="Last page"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
