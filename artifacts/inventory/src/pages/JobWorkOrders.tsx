import { Link } from "wouter";
import { useState } from "react";
import { Can } from "@/components/Can";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  fetchJobWorkOrdersPaginated,
  useListSuppliers,
} from "@/lib/queryKeys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { Plus, Search } from "lucide-react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "partially_received", label: "Partially received" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

export default function JobWorkOrders() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState(15);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 400);

  const { data: suppliersData } = useListSuppliers();
  const jobWorkers = (suppliersData?.suppliers ?? []).filter((s) => s.isJobWorker);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "job-work-orders-paginated",
      { page, pageSize, statusFilter, supplierFilter, search: debouncedSearch },
    ],
    queryFn: () =>
      fetchJobWorkOrdersPaginated({
        page,
        pageSize,
        status: statusFilter === "all" ? undefined : statusFilter,
        supplierId: supplierFilter === "all" ? undefined : Number(supplierFilter),
        search: debouncedSearch || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Work"
        description="Send raw materials to outside workers and track finished goods."
        actions={
          <Can module="job_work" action="create">
            <Button asChild data-testid="btn-create-job-work-order">
              <Link href="/job-work/new">
                <Plus className="mr-2 h-4 w-4" />
                New Job Work Order
              </Link>
            </Button>
          </Can>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-end gap-4 bg-card border rounded-lg p-4">
        <div className="relative space-y-1 w-full sm:w-60">
          <Label>Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="JWO # or item name…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              className="pl-8"
              data-testid="filter-jwo-search"
            />
          </div>
        </div>
        <div className="space-y-1 w-full sm:w-56">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
            <SelectTrigger data-testid="filter-jwo-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 w-full sm:w-64">
          <Label>Job worker</Label>
          <Select value={supplierFilter} onValueChange={(v) => { setSupplierFilter(v); resetPage(); }}>
            <SelectTrigger data-testid="filter-jwo-supplier">
              <SelectValue placeholder="All workers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workers</SelectItem>
              {jobWorkers.map((s) => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>JWO #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Job worker</TableHead>
              <TableHead>Output</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} cols={8} />
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-sm">
                  <div className="space-y-2">
                    <p className="text-destructive">
                      Could not load job work orders.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(error as Error)?.message ?? "Unknown error"}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => refetch()}
                      data-testid="btn-jwo-retry"
                    >
                      Try again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {total === 0 && !search && statusFilter === "all" && supplierFilter === "all"
                    ? "No job work orders yet. Create one to send materials to a job worker."
                    : "No job work orders match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => {
                const planned = Number(o.outputQuantity);
                const received = Number(o.receivedQuantity ?? 0);
                const pending = Number(
                  o.remainingQuantity ?? Math.max(0, planned - received),
                );
                return (
                  <TableRow key={o.id} data-testid={`row-jwo-${o.id}`}>
                    <TableCell className="font-mono">
                      <Link
                        href={`/job-work/${o.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {o.jwoNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(o.createdAt)}</TableCell>
                    <TableCell>{o.supplierName}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{o.outputItemName}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {o.outputItemSku}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {planned}
                    </TableCell>
                    <TableCell className="text-right">{received}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          pending > 0
                            ? "text-orange-600 font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {pending}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        itemLabel="job work orders"
      />
    </div>
  );
}
