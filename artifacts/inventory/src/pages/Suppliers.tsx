import { useEffect, useRef, useState } from "react";
import { Can } from "@/components/Can";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { useFocusParam, useNewParam } from "@/hooks/use-focus-param";
import { recordVisit } from "@/lib/recentRecords";
import {
  fetchSuppliersPaginated,
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  getListSuppliersQueryKey,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { Plus, Search, MoreHorizontal, Edit, Trash2, ArrowUp, ArrowDown, ArrowUpDown, IndianRupee, AlertCircle } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { TableSkeleton } from "@/components/TableSkeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";
import type { Supplier } from "@/lib/queryKeys";

const supplierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  company: z.string().optional(),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  isJobWorker: z.boolean().optional(),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;

export default function Suppliers() {
  const { values, set, setMany, reset, debouncedSearch } = useListFilters({
    search: "",
    sort: "name",
    sortDir: "asc",
    hasBalance: "false",
    overdue: "false",
  });
  const search = values.search;
  const sortBy = values.sort;
  const sortDir = values.sortDir as "asc" | "desc";
  const hasBalance = values.hasBalance === "true";
  const overdueOnly = values.overdue === "true";
  const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers-paginated", { page, pageSize, search: debouncedSearch, sortBy, sortDir, hasBalance, overdueOnly }],
    queryFn: () =>
      fetchSuppliersPaginated({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        sortBy,
        sortDir,
        hasBalance: hasBalance || undefined,
        overdueOnly: overdueOnly || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const suppliers = data?.suppliers ?? [];
  const total = data?.total ?? 0;
  const totalPayable = data?.totalPayable ?? "0";
  const overduePayablesCount = data?.overduePayablesCount ?? 0;
  const overduePayablesAmount = parseFloat(data?.overduePayablesAmount ?? "0") || 0;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deleteDialogSupplier, setDeleteDialogSupplier] = useState<Supplier | null>(null);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["suppliers-paginated"] });
    queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
  };

  const createMutation = useCreateSupplier({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setSheetOpen(false);
        toast({ title: "Supplier created successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        toast({ title: "Failed to create supplier", description: e.data?.error ?? "Please try again.", variant: "destructive" });
      },
    }
  });

  const updateMutation = useUpdateSupplier({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setSheetOpen(false);
        toast({ title: "Supplier updated successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        toast({ title: "Failed to update supplier", description: e.data?.error ?? "Please try again.", variant: "destructive" });
      },
    }
  });

  const deleteMutation = useDeleteSupplier({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        setDeleteDialogSupplier(null);
        toast({ title: "Supplier deleted successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        toast({ title: "Failed to delete supplier", description: e.data?.error ?? "Please try again.", variant: "destructive" });
      },
    }
  });

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      company: "",
      gstNumber: "",
      address: "",
      notes: "",
      isJobWorker: false,
    }
  });

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    form.reset({
      name: supplier.name,
      email: supplier.email || "",
      phone: supplier.phone || "",
      company: supplier.company || "",
      gstNumber: supplier.gstNumber || "",
      address: supplier.address || "",
      notes: supplier.notes || "",
      isJobWorker: supplier.isJobWorker ?? false,
    });
    setSheetOpen(true);
  };

  const { focusId, clear: clearFocus } = useFocusParam();
  const focusedHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusId == null || !suppliers.length) return;
    if (focusedHandledRef.current === focusId) return;
    const target = suppliers.find((s) => s.id === focusId);
    if (!target) return;
    focusedHandledRef.current = focusId;
    handleEdit(target);
    recordVisit({
      kind: "supplier",
      id: target.id,
      title: target.name,
      subtitle: target.company ?? target.email ?? undefined,
      href: `/suppliers?focus=${target.id}`,
    });
    clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, suppliers]);

  const handleCreate = () => {
    setEditingSupplier(null);
    form.reset({
      name: "",
      email: "",
      phone: "",
      company: "",
      gstNumber: "",
      address: "",
      notes: "",
      isJobWorker: false,
    });
    setSheetOpen(true);
  };

  const { shouldOpenNew, clear: clearNew } = useNewParam();
  const newHandledRef = useRef(false);
  useEffect(() => {
    if (!shouldOpenNew) {
      newHandledRef.current = false;
      return;
    }
    if (newHandledRef.current) return;
    newHandledRef.current = true;
    handleCreate();
    clearNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldOpenNew]);

  const onSubmit = (data: SupplierFormValues) => {
    const payload = {
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      company: data.company || null,
      gstNumber: data.gstNumber || null,
      address: data.address || null,
      notes: data.notes || null,
      isJobWorker: data.isJobWorker ?? false,
    };

    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const handleSort = (col: string) => {
    const newDir: "asc" | "desc" = values.sort === col ? (values.sortDir === "desc" ? "asc" : "desc") : "desc";
    setMany({ sort: col, sortDir: newDir });
    setPage(1);
  };
  const SortIcon = ({ col }: { col: string }) =>
    sortBy === col
      ? sortDir === "asc"
        ? <ArrowUp className="h-3.5 w-3.5" />
        : <ArrowDown className="h-3.5 w-3.5" />
      : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Manage your vendors and payable balances."
        actions={
          <Can module="suppliers" action="create">
            <Button onClick={handleCreate} data-testid="btn-create-supplier">
              <Plus className="mr-2 h-4 w-4" />
              Add Supplier
            </Button>
          </Can>
        }
      />

      <FilterBar
        search={values.search}
        onSearchChange={(v) => { set("search", v); setPage(1); }}
        searchPlaceholder="Search suppliers..."
        filterDefs={[
          { key: "hasBalance", label: "Has outstanding balance", type: "boolean" },
          { key: "overdue", label: "Overdue only", type: "boolean" },
        ]}
        filterValues={values}
        onFilterChange={(k, v) => { set(k, v); setPage(1); }}
        sortDefs={[
          { key: "name", label: "Name" },
          { key: "balance", label: "Balance" },
          { key: "createdAt", label: "Date created" },
        ]}
        sortValues={{ sortBy: values.sort, sortDir: values.sortDir as "asc" | "desc" }}
        onSortChange={(s, d) => { setMany({ sort: s, sortDir: d }); setPage(1); }}
        sortDefaultDir="asc"
        onReset={() => { reset(); setPage(1); }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600 shrink-0">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground" data-testid="text-stat-title-total-payable">
              {hasBalance || debouncedSearch ? "Payable (filtered)" : "Total Payable"}
            </p>
            <p className="text-xl font-semibold text-orange-600 tabular-nums" data-testid="text-stat-value-total-payable">
              {isLoading ? "—" : formatCurrency(parseFloat(totalPayable) || 0)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            set("overdue", overdueOnly ? "false" : "true");
            setPage(1);
          }}
          className={`rounded-lg border p-4 flex items-center gap-3 text-left w-full transition-colors ${
            overdueOnly
              ? "bg-red-50 border-red-300 ring-2 ring-red-300"
              : "bg-card hover:bg-muted/50"
          }`}
          aria-pressed={overdueOnly}
          title={overdueOnly ? "Click to clear overdue filter" : "Click to filter by overdue suppliers"}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600 shrink-0">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground" data-testid="text-stat-title-overdue-payables">
              {overdueOnly ? "Overdue Payables (active)" : hasBalance || debouncedSearch ? "Overdue POs (filtered)" : "Overdue Payables"}
            </p>
            <p className="text-xl font-semibold text-red-600 tabular-nums" data-testid="text-stat-value-overdue-payables">
              {isLoading
                ? "—"
                : overduePayablesCount === 0
                  ? "None"
                  : `${overduePayablesCount} PO${overduePayablesCount !== 1 ? "s" : ""} • ${formatCurrency(overduePayablesAmount)}`}
            </p>
          </div>
        </button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("name")}>
                <span className="flex items-center gap-1">Name <SortIcon col="name" /></span>
              </TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("payable")}>
                <span className="flex items-center justify-end gap-1">Payable <SortIcon col="payable" /></span>
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={8} cols={5} />
            ) : suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {search || hasBalance ? "No suppliers match your filters." : "No suppliers yet."}
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((supplier) => (
                <TableRow key={supplier.id} data-testid={`row-supplier-${supplier.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/suppliers/${supplier.id}`} className="text-primary hover:underline">
                      {supplier.name}
                    </Link>
                  </TableCell>
                  <TableCell>{supplier.company || "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      {supplier.email && <span className="text-muted-foreground">{supplier.email}</span>}
                      {supplier.phone && <span className="text-muted-foreground">{supplier.phone}</span>}
                      {!supplier.email && !supplier.phone && "-"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <span className={supplier.outstandingPayable > 0 ? "text-orange-600" : ""}>
                      {formatCurrency(supplier.outstandingPayable)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`btn-supplier-menu-${supplier.id}`}>
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <Can module="suppliers" action="edit">
                          <DropdownMenuItem onClick={() => handleEdit(supplier)} data-testid={`btn-edit-supplier-${supplier.id}`}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </Can>
                        <Can module="suppliers" action="delete">
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => setDeleteDialogSupplier(supplier)}
                            data-testid={`btn-delete-supplier-${supplier.id}`}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </Can>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
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
        itemLabel="suppliers"
      />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingSupplier ? "Edit Supplier" : "Create Supplier"}</SheetTitle>
            <SheetDescription>
              {editingSupplier ? "Update supplier details." : "Add a new supplier to your database."}
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-supplier-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="company"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-supplier-company" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} data-testid="input-supplier-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-supplier-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="gstNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GST Number</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-supplier-gst" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-supplier-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isJobWorker"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-supplier-job-worker"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Job worker</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Mark this supplier as a job worker so they appear in the Job Work order picker.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
              <div className="pt-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="btn-save-supplier"
                >
                  {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save Supplier"}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteDialogSupplier} onOpenChange={(open) => !open && setDeleteDialogSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteDialogSupplier?.name}? This action cannot be undone.
              Suppliers with existing purchase orders cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDialogSupplier && deleteMutation.mutate({ id: deleteDialogSupplier.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
