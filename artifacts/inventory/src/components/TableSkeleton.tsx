import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  /** Column widths as tailwind w-* fractions or fixed sizes, e.g. ["w-1/4","w-1/3","w-1/4","w-1/6"] */
  colWidths?: string[];
}

export function TableSkeleton({ rows = 8, cols = 5, colWidths }: TableSkeletonProps) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, ri) => (
        <TableRow key={ri} className="hover:bg-transparent">
          {Array.from({ length: cols }).map((_, ci) => (
            <TableCell key={ci}>
              <Skeleton
                className={`h-4 ${colWidths?.[ci] ?? "w-full"}`}
                style={{ animationDelay: `${(ri * cols + ci) * 30}ms` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
