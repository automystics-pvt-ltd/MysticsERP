import { useEffect, useRef, useState } from "react";
import { Can } from "@/components/Can";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { useFocusParam, useNewParam } from "@/hooks/use-focus-param";
import { recordVisit } from "@/lib/recentRecords";
import {
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  getListCustomersQueryKey,
  fetchCustomersPaginated,
  type CustomersPage,
  type Customer,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/TableSkeleton";
import { TablePagination } from "@/components/TablePagination";
import { formatCurrency } from "@/lib/format";
import { Plus, Search, MoreHorizontal, Edit, Trash2, IndianRupee } from "lucide-react";
import { Link } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { INDIAN_STATES } from "@/lib/indianStates";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useListFilters } from "@/hooks/use-list-filters";
import { FilterBar } from "@/components/FilterBar";

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  company: z.string().optional(),
  gstNumber: z.string().optional(),
  billingAddress: z.string().optional(),
  shippingAddress: z.string().optional(),
  placeOfSupply: z.string().optional(),
  notes: z.string().optional(),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

export default function Customers() {
  const { values, set, setMany, reset, debouncedSearch } = useListFilters({
    search: "",
    hasBalance: "false",
    sort: "name",
    sortDir: "asc",
  });
  const search = values.search;
  const hasBalance = values.hasBalance === "true";
  const sortBy = values.sort as "name" | "balance" | "createdAt";
  const sortDir = values.sortDir as "asc" | "desc";
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);

  const queryParams = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    hasBalance: hasBalance || undefined,
    sortBy,
    sortDir,
  };

  const { data, isLoading } = useQuery<CustomersPage>({
    queryKey: [...getListCustomersQueryKey(), queryParams],
    queryFn: () => fetchCustomersPaginated(queryParams),
    placeholderData: (prev) => prev,
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const totalOutstanding = data?.totalOutstanding ?? "0";

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deleteDialogCustomer, setDeleteDialogCustomer] = useState<Customer | null>(null);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const createMutation = useCreateCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setSheetOpen(false);
        toast({ title: "Customer created successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        toast({ title: "Failed to create customer", description: e.data?.error ?? "Please try again.", variant: "destructive" });
      },
    }
  });

  const updateMutation = useUpdateCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setSheetOpen(false);
        toast({ title: "Customer updated successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        toast({ title: "Failed to update customer", description: e.data?.error ?? "Please try again.", variant: "destructive" });
      },
    }
  });

  const deleteMutation = useDeleteCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setDeleteDialogCustomer(null);
        toast({ title: "Customer deleted successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        toast({ title: "Failed to delete customer", description: e.data?.error ?? "Please try again.", variant: "destructive" });
      },
    }
  });

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      company: "",
      gstNumber: "",
      billingAddress: "",
      shippingAddress: "",
      placeOfSupply: "",
      notes: "",
    }
  });

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    form.reset({
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || "",
      company: customer.company || "",
      gstNumber: customer.gstNumber || "",
      billingAddress: customer.billingAddress || "",
      shippingAddress: customer.shippingAddress || "",
      placeOfSupply: customer.placeOfSupply || "",
      notes: customer.notes || "",
    });
    setSheetOpen(true);
  };

  // Auto-open the edit sheet when arriving via the command palette
  // with ?focus=<id>. We only fire once per focus value, then strip
  // the param so a refresh doesn't re-trigger. If the customer is not
  // on the current page (due to server-side pagination), we fetch it
  // directly by ID so command-palette deep links always work.
  const { focusId, clear: clearFocus } = useFocusParam();
  const focusedHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusId == null) return;
    if (focusedHandledRef.current === focusId) return;

    const inPage = customers.find((c) => c.id === focusId);
    if (inPage) {
      focusedHandledRef.current = focusId;
      handleEdit(inPage);
      recordVisit({
        kind: "customer",
        id: inPage.id,
        title: inPage.name,
        subtitle: inPage.company ?? inPage.email ?? undefined,
        href: `/customers?focus=${inPage.id}`,
      });
      clearFocus();
      return;
    }

    // Not on current page — fetch directly.
    fetch(`/api/customers/${focusId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const c = data as Customer;
        focusedHandledRef.current = focusId;
        handleEdit(c);
        recordVisit({
          kind: "customer",
          id: c.id,
          title: c.name,
          subtitle: c.company ?? c.email ?? undefined,
          href: `/customers?focus=${c.id}`,
        });
        clearFocus();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, customers]);

  const handleCreate = () => {
    setEditingCustomer(null);
    form.reset({
      name: "",
      email: "",
      phone: "",
      company: "",
      gstNumber: "",
      billingAddress: "",
      shippingAddress: "",
      placeOfSupply: "",
      notes: "",
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

  const onSubmit = (data: CustomerFormValues) => {
    const payload = {
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      company: data.company || null,
      gstNumber: data.gstNumber || null,
      billingAddress: data.billingAddress || null,
      shippingAddress: data.shippingAddress || null,
      placeOfSupply: data.placeOfSupply || null,
      notes: data.notes || null,
    };

    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Customers" 
        description="Manage your clients and track their outstanding balances."
        actions={
          <Can module="customers" action="create">
            <Button onClick={handleCreate} data-testid="btn-create-customer">
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          </Can>
        }
      />

      <FilterBar
        search={values.search}
        onSearchChange={(v) => { set("search", v); setPage(1); }}
        searchPlaceholder="Search customers..."
        filterDefs={[
          { key: "hasBalance", label: "Outstanding balance only", type: "boolean" },
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
        onReset={() => { reset(); setPage(1); }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600 shrink-0">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground" data-testid="text-stat-title-total-outstanding">
              {hasBalance || debouncedSearch ? "Outstanding (filtered)" : "Total Outstanding"}
            </p>
            <p className="text-xl font-semibold text-orange-600 tabular-nums" data-testid="text-stat-value-total-outstanding">
              {isLoading ? "—" : formatCurrency(parseFloat(totalOutstanding) || 0)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          {isLoading ? (
            <TableSkeleton rows={8} cols={5} />
          ) : (
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {search || hasBalance ? "No customers match the current filters." : "No customers yet. Add one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id} data-testid={`row-customer-${customer.id}`}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-primary hover:underline"
                      data-testid={`link-customer-${customer.id}`}
                    >
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>{customer.company || "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      {customer.email && <span className="text-muted-foreground">{customer.email}</span>}
                      {customer.phone && <span className="text-muted-foreground">{customer.phone}</span>}
                      {!customer.email && !customer.phone && "-"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={customer.outstandingBalance > 0 ? "text-orange-600" : ""}>
                        {formatCurrency(customer.outstandingBalance)}
                      </span>
                      {customer.overdueBalance > 0 && (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                          {formatCurrency(customer.overdueBalance)} overdue
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`btn-customer-menu-${customer.id}`}>
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <Can module="customers" action="edit">
                          <DropdownMenuItem onClick={() => handleEdit(customer)} data-testid={`btn-edit-customer-${customer.id}`}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </Can>
                        <DropdownMenuItem asChild data-testid={`btn-view-payments-${customer.id}`}>
                          <Link href={`/customers/${customer.id}?tab=payments`}>
                            <IndianRupee className="mr-2 h-4 w-4" />
                            View payments
                          </Link>
                        </DropdownMenuItem>
                        <Can module="customers" action="delete">
                          <DropdownMenuItem 
                            className="text-red-600 focus:text-red-600" 
                            onClick={() => setDeleteDialogCustomer(customer)}
                            data-testid={`btn-delete-customer-${customer.id}`}
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
          )}
        </Table>
      </div>

      <TablePagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        itemLabel="customers"
      />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingCustomer ? "Edit Customer" : "Create Customer"}</SheetTitle>
            <SheetDescription>
              {editingCustomer ? "Update customer details." : "Add a new customer to your database."}
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
                      <Input {...field} data-testid="input-customer-name" />
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
                      <Input {...field} data-testid="input-customer-company" />
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
                        <Input type="email" {...field} data-testid="input-customer-email" />
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
                        <Input {...field} data-testid="input-customer-phone" />
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
                      <Input {...field} data-testid="input-customer-gst" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billingAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Address</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-customer-billing" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="shippingAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shipping Address</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-customer-shipping" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="placeOfSupply"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Place of Supply</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-customer-place-of-supply">
                          <SelectValue placeholder="Select state (for GST)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {INDIAN_STATES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Same state as your business → CGST + SGST. Different state → IGST.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="pt-4 flex justify-end">
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="btn-save-customer"
                >
                  {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save Customer"}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteDialogCustomer} onOpenChange={(open) => !open && setDeleteDialogCustomer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteDialogCustomer?.name}? This action cannot be undone.
              Customers with existing sales orders cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deleteDialogCustomer && deleteMutation.mutate({ id: deleteDialogCustomer.id })}
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
