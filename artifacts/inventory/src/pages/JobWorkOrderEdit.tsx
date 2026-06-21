import { PageHeader } from "@/components/PageHeader";
import {
  useGetJobWorkOrder,
  useUpdateJobWorkOrder,
  useListItems,
  getListJobWorkOrdersQueryKey,
  getGetJobWorkOrderQueryKey,
} from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, ArrowLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useEffect } from "react";
import { useCanI } from "@/hooks/usePermissions";

const componentSchema = z.object({
  componentItemId: z.coerce.number().min(1, "Component required"),
  quantityPerOutput: z.coerce.number().gt(0, "Must be > 0"),
});

const additionalMaterialSchema = z.object({
  name: z.string().min(1, "Name required"),
  quantity: z.coerce.number().gt(0, "Must be > 0"),
  unit: z.string().optional(),
});

const schema = z
  .object({
    outputQuantity: z.coerce.number().gt(0, "Must be > 0"),
    jobChargeRate: z.coerce.number().min(0).optional(),
    expectedReturnDate: z.string().optional(),
    notes: z.string().optional(),
    components: z
      .array(componentSchema)
      .min(1, "At least one component is required"),
    additionalMaterials: z.array(additionalMaterialSchema).optional(),
  })
  .refine(
    (d) =>
      new Set(d.components.map((c) => c.componentItemId)).size ===
      d.components.length,
    {
      message: "Each component can only be listed once",
      path: ["components"],
    },
  );

type FormValues = z.infer<typeof schema>;

export default function JobWorkOrderEdit() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id ?? 0);
  const [, setLocation] = useLocation();
  const canEdit = useCanI("job_work", "edit");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: detail, isLoading } = useGetJobWorkOrder(orderId);
  const { data: items } = useListItems({ leafOnly: true });

  const order = detail?.order;
  const existingComponents = detail?.components ?? [];

  useEffect(() => {
    if (!canEdit) setLocation(`/job-work/${orderId}`);
  }, [canEdit, orderId, setLocation]);

  useEffect(() => {
    if (order && order.status !== "draft") {
      setLocation(`/job-work/${orderId}`);
    }
  }, [order, orderId, setLocation]);

  const updateMutation = useUpdateJobWorkOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetJobWorkOrderQueryKey(orderId),
        });
        queryClient.invalidateQueries({
          queryKey: getListJobWorkOrdersQueryKey(),
        });
        toast({ title: "Job work order updated" });
        setLocation(`/job-work/${orderId}`);
      },
      onError: (err: unknown) => {
        const e = err as {
          data?: { error?: string };
          response?: { data?: { error?: string } };
        };
        toast({
          title: "Could not update order",
          description:
            e.data?.error ??
            e.response?.data?.error ??
            "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      outputQuantity: 1,
      jobChargeRate: 0,
      expectedReturnDate: "",
      notes: "",
      components: [{ componentItemId: 0, quantityPerOutput: 1 }],
      additionalMaterials: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "components",
  });

  const {
    fields: amFields,
    append: amAppend,
    remove: amRemove,
  } = useFieldArray({
    control: form.control,
    name: "additionalMaterials",
  });

  // Pre-populate form once order data loads.
  useEffect(() => {
    if (!order || existingComponents.length === 0) return;
    form.reset({
      outputQuantity: Number(order.outputQuantity),
      jobChargeRate: Number(order.jobChargeRate),
      expectedReturnDate: order.expectedReturnDate ?? "",
      notes: order.notes ?? "",
      components: existingComponents.map((c) => ({
        componentItemId: c.componentItemId,
        quantityPerOutput: Number(c.quantityPerOutput),
      })),
      additionalMaterials: (order.additionalMaterials ?? []).map((m) => ({
        name: m.name,
        quantity: m.quantity,
        unit: m.unit ?? "",
      })),
    });
  }, [order, existingComponents, form]);

  const onSubmit = (data: FormValues) => {
    updateMutation.mutate({
      id: orderId,
      data: {
        outputQuantity: data.outputQuantity,
        jobChargeRate: data.jobChargeRate ?? 0,
        expectedReturnDate: data.expectedReturnDate || null,
        notes: data.notes || null,
        components: data.components,
        additionalMaterials: (data.additionalMaterials ?? []).filter(
          (m) => m.name.trim() !== "" && m.quantity > 0,
        ),
      },
    });
  };

  const MATERIAL_CATEGORIES = ["Accessories", "Raw Materials"];
  const componentItems = (items ?? []).filter(
    (i) => !i.hasVariants && !i.isBundle && MATERIAL_CATEGORIES.includes(i.category ?? ""),
  );

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-6 max-w-5xl">
        <PageHeader title="Order not found" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/job-work/${orderId}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader
          title={`Edit ${order.jwoNumber}`}
          description="Draft order — all fields can be changed"
          className="mb-0"
        />
      </div>

      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Job worker</div>
              <div className="mt-1 font-medium">{order.supplierName}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Finished item</div>
              <div className="mt-1 font-medium">{order.outputItemName}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Source warehouse</div>
              <div className="mt-1 font-medium">{order.sourceWarehouseName}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide">Destination warehouse</div>
              <div className="mt-1 font-medium">{order.destWarehouseName}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Job worker, finished item and warehouses cannot be changed after creation. Cancel and recreate to change them.
          </p>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="outputQuantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity to produce *</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="decimal"
                          {...field}
                          data-testid="input-output-quantity"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="jobChargeRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job charge per unit (₹)</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="decimal"
                          {...field}
                          data-testid="input-job-charge-rate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expectedReturnDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected return date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          data-testid="input-expected-return"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-lg">Raw materials (inventory-tracked)</h3>
              </div>

              <div className="space-y-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex gap-3 items-start border p-4 rounded-lg bg-muted/20"
                  >
                    <div className="grid grid-cols-12 gap-3 w-full">
                      <div className="col-span-12 md:col-span-8">
                        <FormField
                          control={form.control}
                          name={`components.${index}.componentItemId`}
                          render={({ field: selectField }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Component</FormLabel>
                              <Select
                                onValueChange={selectField.onChange}
                                value={
                                  selectField.value
                                    ? selectField.value.toString()
                                    : ""
                                }
                              >
                                <FormControl>
                                  <SelectTrigger
                                    data-testid={`select-component-${index}`}
                                  >
                                    <SelectValue placeholder="Pick a raw material" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {componentItems.map((i) => (
                                    <SelectItem
                                      key={i.id}
                                      value={i.id.toString()}
                                    >
                                      {i.name}
                                      {i.sku ? ` (${i.sku})` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-12 md:col-span-4">
                        <FormField
                          control={form.control}
                          name={`components.${index}.quantityPerOutput`}
                          render={({ field: inputField }) => (
                            <FormItem>
                              <FormLabel className="text-xs">
                                Qty per finished unit
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  {...inputField}
                                  data-testid={`input-component-qty-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive h-9 w-9 mt-6"
                        onClick={() => remove(index)}
                        data-testid={`btn-remove-component-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() =>
                  append({ componentItemId: 0, quantityPerOutput: 1 })
                }
                data-testid="btn-add-component"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add component
              </Button>


              <Separator className="my-6" />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        className="h-24"
                        placeholder="Process notes, quality requirements, lot details, etc."
                        data-testid="input-notes"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" asChild>
              <Link href={`/job-work/${orderId}`}>Cancel</Link>
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              data-testid="btn-submit-jwo-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
