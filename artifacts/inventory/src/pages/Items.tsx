import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Can } from "@/components/Can";
import { useCanI } from "@/hooks/usePermissions";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { useFocusParam, useNewParam } from "@/hooks/use-focus-param";
import {
  useListItems,
  useListWarehouses,
  useCreateItem,
  useUpdateItem,
  useDeleteItem,
  getListItemsQueryKey,
  getItem,
  lookupItemByCode,
  fetchItemsPaginated,
  fetchItemsFacets,
  fetchItemVariants,
  type ItemsPage,
} from "@/lib/queryKeys";
import {
  Select,
  SelectContent,
  SelectItem as SelectItemUI,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import {
  Plus,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  ChevronRight,
  ChevronDown,
  Upload,
  ScanLine,
  Store,
  SlidersHorizontal,
  X,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { BulkImportItemsDialog } from "@/components/BulkImportItemsDialog";
import { FilterBar, type FilterChip } from "@/components/FilterBar";
import { CreatableCombobox } from "@/components/CreatableCombobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { STALE_LIST, STALE_REFERENCE } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import { Item, useGetMe, bulkMoveWarehouse, useGetCurrentOrganization } from "@/lib/queryKeys";
import { customFetch } from "@workspace/api-client-react";
import { normalizeRole } from "@/lib/permissions";
import { ImageUploader } from "@/components/ImageUploader";
import { useImageSrc } from "@/hooks/use-image-src";
import { ReportExportButton, type ExportColumn } from "@/components/ReportExportButton";
import { BulkEditItemsDialog } from "@/components/BulkEditItemsDialog";

const COMMON_UNITS = [
  "pcs",
  "box",
  "pack",
  "set",
  "pair",
  "dozen",
  "kg",
  "g",
  "mg",
  "lb",
  "l",
  "ml",
  "m",
  "cm",
  "mm",
  "ft",
  "in",
  "sqft",
  "sqm",
  "roll",
  "bottle",
  "can",
  "bag",
  "carton",
  "unit",
];

const componentRowSchema = z.object({
  componentItemId: z.coerce.number().int().min(1),
  quantityPerBundle: z.coerce.number().positive(),
});

const itemSchema = z
  .object({
    sku: z.string(),
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    category: z.string().optional(),
    brand: z.string().optional(),
    unit: z.string().min(1, "Unit is required"),
    salePrice: z.coerce.number().min(0),
    purchasePrice: z.coerce.number().min(0),
    hsnCode: z.string().optional(),
    barcode: z
      .string()
      .max(64, "Barcode must be 64 characters or fewer")
      .optional(),
    taxRate: z.coerce.number().min(0).max(100),
    reorderLevel: z.coerce.number().min(0),
    openingStock: z.coerce.number().min(0).optional(),
    imageUrl: z
      .string()
      .max(2048, "Image URL is too long")
      .optional()
      .or(z.literal("")),
    hasVariants: z.boolean().default(false),
    axes: z.string().optional(),
    isBundle: z.boolean().default(false),
    components: z.array(componentRowSchema).default([]),
    trackBatches: z.boolean().default(false),
    allowBackorder: z.boolean().default(false),
    maxDiscountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
    weight: z.coerce.number().min(0).optional().nullable(),
    weightUnit: z.string().default("g"),
    dimensionLength: z.coerce.number().min(0).optional().nullable(),
    dimensionWidth: z.coerce.number().min(0).optional().nullable(),
    dimensionHeight: z.coerce.number().min(0).optional().nullable(),
    dimensionUnit: z.string().default("cm"),
  })
  .refine(
    (v) => {
      if (!v.hasVariants) return true;
      const list = (v.axes ?? "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      return list.length >= 1 && list.length <= 3;
    },
    {
      path: ["axes"],
      message:
        "Provide 1-3 comma-separated axis names (e.g. Size, Color)",
    },
  )
  .refine((v) => !(v.isBundle && v.hasVariants), {
    path: ["isBundle"],
    message: "An item cannot be both a bundle and a variant parent",
  })
  .refine(
    (v) => {
      if (!v.isBundle) return true;
      if (v.components.length === 0) return false;
      const ids = v.components.map((c) => c.componentItemId);
      return new Set(ids).size === ids.length;
    },
    {
      path: ["components"],
      message:
        "A bundle needs at least one component and component items cannot repeat",
    },
  )
  .refine(
    (v) =>
      v.salePrice == null ||
      v.purchasePrice == null ||
      v.purchasePrice <= 0 ||
      v.salePrice <= v.purchasePrice,
    {
      path: ["salePrice"],
      message: "Sale price must not exceed MRP",
    },
  );

type ItemFormValues = z.infer<typeof itemSchema>;

/**
 * Read variantOptions for a parent into a "Size, Color" axis string for
 * display in the form.
 */
function axesString(opts: Item["variantOptions"]): string {
  if (!opts || typeof opts !== "object") return "";
  const axes = (opts as { axes?: unknown }).axes;
  if (!Array.isArray(axes)) return "";
  return axes.filter((a) => typeof a === "string").join(", ");
}

/**
 * Render the option values of a variant ({Size: "M", Color: "Red"}) as
 * a compact "M / Red" label.
 */
/**
 * Compact 40x40 thumbnail for an item row. Falls back to a neutral
 * placeholder when no image is set or the URL is blank.
 */
function ItemThumb({ url, alt }: { url: string | null | undefined; alt: string }) {
  const { src } = useImageSrc(url);
  if (!src) {
    return (
      <div
        className="h-10 w-10 rounded-md border bg-muted/30"
        aria-hidden
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="h-10 w-10 rounded-md border object-cover"
    />
  );
}

function variantLabel(opts: Item["variantOptions"]): string {
  if (!opts || typeof opts !== "object") return "";
  const entries = Object.entries(opts as Record<string, unknown>).filter(
    ([k]) => k !== "axes",
  );
  return entries
    .map(([, v]) => (typeof v === "string" ? v : ""))
    .filter(Boolean)
    .join(" / ");
}


const WAREHOUSE_FILTER_KEY = "items.warehouseFilter";

/**
 * Render the Warehouse cell for an item row. When a specific warehouse
 * is picked the cell just shows that warehouse's name; under the "all
 * warehouses" view it shows the warehouse holding the most stock plus
 * a "+N more" badge with a hover breakdown when stock is split. Items
 * with no warehouse assignment render as "—".
 */
function WarehouseCell({
  item,
  scopedWarehouseName,
  testId,
}: {
  item: Item;
  scopedWarehouseName: string | null;
  testId: string;
}) {
  if (scopedWarehouseName) {
    return (
      <span data-testid={testId} className="text-sm">
        {scopedWarehouseName}
      </span>
    );
  }
  const breakdown = item.warehouseStock ?? [];
  if (breakdown.length === 0) {
    return (
      <span data-testid={testId} className="text-muted-foreground">
        —
      </span>
    );
  }
  // Sort by quantity desc (warehouses with stock first) then by name for
  // a deterministic tie-break.
  const sorted = [...breakdown].sort(
    (a, b) =>
      b.quantity - a.quantity ||
      a.warehouseName.localeCompare(b.warehouseName),
  );
  const top = sorted[0];
  const others = sorted.slice(1);
  return (
    <div className="flex items-center gap-1.5" data-testid={testId}>
      <span className="text-sm">
        {top.warehouseName}
        <span className="ml-1 text-xs text-muted-foreground font-mono">
          ({top.quantity} {item.unit})
        </span>
      </span>
      {others.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="cursor-default font-normal"
              data-testid={`${testId}-more`}
            >
              +{others.length} more
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            <div className="space-y-1 text-xs">
              {sorted.map((w) => (
                <div
                  key={w.warehouseId}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{w.warehouseName}</span>
                  <span className="font-mono">
                    {w.quantity} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default function Items() {
  const { data: me } = useGetMe();
  const { data: org } = useGetCurrentOrganization();
  const orgAny = org as (typeof org & {
    showMaxDiscountAmount?: boolean | null;
    showMaxDiscountPercent?: boolean | null;
  }) | undefined;
  const showMaxDiscountAmount = orgAny?.showMaxDiscountAmount ?? true;
  const showMaxDiscountPercent = orgAny?.showMaxDiscountPercent ?? true;

  const orgSkuAny = org as (typeof org & {
    skuMode?: string | null;
    skuPrefix?: string | null;
    skuNextNumber?: number | null;
  }) | undefined;
  const orgSkuMode = (orgSkuAny?.skuMode ?? "manual") as "auto" | "manual";

  // Computes the preview SKU from cached org data (no backend call needed for display).
  const computePreviewSku = () => {
    const prefix = orgSkuAny?.skuPrefix ?? "";
    const seqNum = orgSkuAny?.skuNextNumber ?? 1;
    const paddedNum = String(seqNum).padStart(5, "0");
    return prefix ? `${prefix}-${paddedNum}` : paddedNum;
  };

  const [autoSkuPreview, setAutoSkuPreview] = useState<string | null>(null);
  const [skuRefreshing, setSkuRefreshing] = useState(false);

  const refreshNextSku = async () => {
    setSkuRefreshing(true);
    try {
      const res = await customFetch<{ sku: string | null }>("/api/items/next-sku");
      if (res.sku) {
        setAutoSkuPreview(res.sku);
        form.setValue("sku", res.sku, { shouldValidate: false });
      }
    } finally {
      setSkuRefreshing(false);
    }
  };

  const canEditStocksForUser =
    (me?.user?.isSuperAdmin ?? false) ||
    (["owner", "admin", "manager"] as const).some((r) => r === normalizeRole(me?.role)) ||
    (me?.canEditStocks ?? false);

  const canBulkDelete = useCanI("items", "delete");

  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const debouncedSearch = useDebounce(search, 500);
  // Warehouse filter — last selection remembered in localStorage.
  const [warehouseFilter, setWarehouseFilterState] = useState<number | "all">(
    () => {
      if (typeof window === "undefined") return "all";
      const raw = window.localStorage.getItem(WAREHOUSE_FILTER_KEY);
      if (!raw || raw === "all") return "all";
      const n = Number(raw);
      return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : "all";
    },
  );
  const setWarehouseFilter = (v: number | "all") => {
    setWarehouseFilterState(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        WAREHOUSE_FILTER_KEY,
        v === "all" ? "all" : String(v),
      );
    }
  };
  const { data: warehouses } = useListWarehouses();
  const visibleWarehouses = useMemo(
    () => (warehouses ?? []).filter((w) => !w.isVirtual),
    [warehouses],
  );
  // If the saved warehouseId no longer exists (deleted/hidden), fall back to "all".
  useEffect(() => {
    if (warehouseFilter === "all" || !warehouses) return;
    if (!visibleWarehouses.some((w) => w.id === warehouseFilter)) {
      setWarehouseFilter("all");
    }
  }, [warehouseFilter, warehouses, visibleWarehouses]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deleteDialogItem, setDeleteDialogItem] = useState<Item | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [variantsByParent, setVariantsByParent] = useState<Record<number, Item[]>>({});
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("cat") ?? "",
  );
  const [brandFilter, setBrandFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("brand") ?? "",
  );
  const [stockFilter, setStockFilter] = useState<"all" | "in-stock" | "low-stock" | "out-of-stock">(() => {
    const s = new URLSearchParams(window.location.search).get("stock");
    return (s === "in-stock" || s === "low-stock" || s === "out-of-stock") ? s : "all";
  });
  const [priceMin, setPriceMin] = useState<string>(
    () => new URLSearchParams(window.location.search).get("minPrice") ?? "",
  );
  const [priceMax, setPriceMax] = useState<string>(
    () => new URLSearchParams(window.location.search).get("maxPrice") ?? "",
  );
  const debouncedPriceMin = useDebounce(priceMin, 600);
  const debouncedPriceMax = useDebounce(priceMax, 600);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  // The same scanner dialog is reused from two callsites: the search
  // bar (look up + navigate to the matched item) and the create/edit
  // form barcode field (write the scanned code into the form). Track
  // which one opened it so onDetected knows what to do.
  const [scannerMode, setScannerMode] = useState<
    "search" | "formBarcode" | null
  >(null);
  const scannerOpen = scannerMode !== null;

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Server-side paginated list — top-level items only; variants expand lazily.
  const { data: itemsPage, isLoading } = useQuery<ItemsPage>({
    queryKey: [
      "items-paginated",
      {
        page,
        pageSize,
        search: debouncedSearch || undefined,
        warehouseId: warehouseFilter !== "all" ? warehouseFilter : undefined,
        category: categoryFilter || undefined,
        brand: brandFilter || undefined,
        stockFilter: stockFilter !== "all" ? stockFilter : undefined,
        priceMin: debouncedPriceMin !== "" ? Number(debouncedPriceMin) : undefined,
        priceMax: debouncedPriceMax !== "" ? Number(debouncedPriceMax) : undefined,
      },
    ],
    queryFn: () =>
      fetchItemsPaginated({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        excludeVariants: true,
        includeWarehouseBreakdown: true,
        warehouseId: warehouseFilter !== "all" ? warehouseFilter : undefined,
        category: categoryFilter || undefined,
        brand: brandFilter || undefined,
        stockFilter: stockFilter !== "all" ? stockFilter : undefined,
        priceMin: debouncedPriceMin !== "" ? Number(debouncedPriceMin) : undefined,
        priceMax: debouncedPriceMax !== "" ? Number(debouncedPriceMax) : undefined,
      }),
    placeholderData: (prev) => prev,
    staleTime: STALE_LIST,
  });
  const pagedTopLevel = itemsPage?.items ?? [];
  const scopedWarehouseName =
    warehouseFilter === "all"
      ? null
      : visibleWarehouses.find((w) => w.id === warehouseFilter)?.name ?? null;
  // Light-weight facets (categories, brands, units) — fetched once, cached 5 min.
  const { data: facets } = useQuery({
    queryKey: ["items-facets"],
    queryFn: fetchItemsFacets,
    staleTime: STALE_REFERENCE,
  });
  // Full item list (no breakdown) — still needed for parentInfoMap + CSV export.
  const { data: allItemsForOptions } = useListItems({});
  const categoryOptions = useMemo(
    () => facets?.categories ?? [],
    [facets],
  );
  const brandOptions = useMemo(
    () => facets?.brands ?? [],
    [facets],
  );
  const unitOptions = useMemo(() => {
    const set = new Set<string>(COMMON_UNITS);
    for (const u of facets?.units ?? []) set.add(u);
    return Array.from(set);
  }, [facets]);

  // Expand/collapse parent row — loads variants lazily on first expand.
  const handleToggleExpand = useCallback((parentId: number) => {
    const willExpand = !expanded[parentId];
    setExpanded((m) => ({ ...m, [parentId]: !m[parentId] }));
    if (willExpand && !variantsByParent[parentId]) {
      fetchItemVariants(parentId)
        .then((variants) => setVariantsByParent((prev) => ({ ...prev, [parentId]: variants })))
        .catch(() => {});
    }
  }, [expanded, variantsByParent, fetchItemVariants]);

  // All IDs currently visible in the table (top-level + expanded variants).
  // Used by the select-all checkbox so it can include variant rows.
  const allVisibleIds = useMemo(() => {
    const ids: number[] = pagedTopLevel.map((i) => i.id);
    for (const p of pagedTopLevel) {
      if (expanded[p.id]) {
        for (const v of variantsByParent[p.id] ?? []) {
          ids.push(v.id);
        }
      }
    }
    return ids;
  }, [pagedTopLevel, variantsByParent, expanded]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [categoryFilter, brandFilter, stockFilter, debouncedPriceMin, debouncedPriceMax, debouncedSearch, warehouseFilter]);

  // Sync filter state to URL so the page is bookmarkable / refresh-safe.
  // warehouseFilter is intentionally kept in localStorage only (user preference).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    search ? params.set("q", search) : params.delete("q");
    categoryFilter ? params.set("cat", categoryFilter) : params.delete("cat");
    brandFilter ? params.set("brand", brandFilter) : params.delete("brand");
    stockFilter !== "all" ? params.set("stock", stockFilter) : params.delete("stock");
    priceMin ? params.set("minPrice", priceMin) : params.delete("minPrice");
    priceMax ? params.set("maxPrice", priceMax) : params.delete("maxPrice");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [search, categoryFilter, brandFilter, stockFilter, priceMin, priceMax]);

  const hasAdvancedFilters = stockFilter !== "all" || priceMin !== "" || priceMax !== "" || brandFilter !== "";
  function clearAdvancedFilters() {
    setStockFilter("all");
    setPriceMin("");
    setPriceMax("");
    setBrandFilter("");
  }

  function clearAllItemFilters() {
    setSearch("");
    setCategoryFilter("");
    setWarehouseFilterState("all");
    clearAdvancedFilters();
    setPage(1);
  }

  const itemFilterCount = [
    !!categoryFilter,
    warehouseFilter !== "all",
    !!brandFilter,
    stockFilter !== "all",
    priceMin !== "" || priceMax !== "",
  ].filter(Boolean).length;

  const itemActiveChips: FilterChip[] = [
    ...(categoryFilter ? [{ key: "cat", label: `Category: ${categoryFilter}`, onRemove: () => setCategoryFilter("") }] : []),
    ...(warehouseFilter !== "all" && scopedWarehouseName ? [{ key: "wh", label: `Warehouse: ${scopedWarehouseName}`, onRemove: () => setWarehouseFilterState("all") }] : []),
    ...(brandFilter ? [{ key: "brand", label: `Brand: ${brandFilter}`, onRemove: () => setBrandFilter("") }] : []),
    ...(stockFilter !== "all" ? [{ key: "stock", label: `Stock: ${stockFilter.replace(/-/g, " ")}`, onRemove: () => setStockFilter("all") }] : []),
    ...((priceMin || priceMax) ? [{ key: "price", label: `Price: ${priceMin ? `₹${priceMin}` : "any"} – ${priceMax ? `₹${priceMax}` : "any"}`, onRemove: () => { setPriceMin(""); setPriceMax(""); } }] : []),
  ];

  const parentInfoMap = useMemo(() => {
    const map = new Map<number, { sku: string; axes: string[] }>();
    for (const item of allItemsForOptions ?? []) {
      if (item.hasVariants) {
        const opts = (item.variantOptions as { axes?: string[] } | null) ?? {};
        map.set(item.id, {
          sku: item.sku,
          axes: Array.isArray(opts.axes) ? opts.axes : [],
        });
      }
    }
    return map;
  }, [allItemsForOptions]);

  const exportColumns = useMemo(
    (): ExportColumn<Item>[] => [
      { header: "Name", accessor: (r) => r.name },
      { header: "SKU", accessor: (r) => r.sku },
      { header: "Description", accessor: (r) => r.description ?? "" },
      { header: "Category", accessor: (r) => r.category ?? "" },
      { header: "Unit", accessor: (r) => r.unit },
      { header: "Sale Price", accessor: (r) => r.salePrice },
      { header: "MRP", accessor: (r) => r.purchasePrice },
      { header: "Tax Rate %", accessor: (r) => r.taxRate },
      { header: "HSN Code", accessor: (r) => r.hsnCode ?? "" },
      { header: "Barcode", accessor: (r) => r.barcode ?? "" },
      { header: "Min Stock Level", accessor: (r) => r.reorderLevel },
      { header: "Max Discount Percent", accessor: (r) => r.maxDiscountPercent ?? "" },
      { header: "Max Discount Amount", accessor: (r) => r.maxDiscountAmount ?? "" },
      { header: "Brand", accessor: (r) => (r as { brand?: string | null }).brand ?? "" },
      { header: "Weight", accessor: (r) => (r as { weight?: number | null }).weight ?? "" },
      { header: "Weight Unit", accessor: (r) => (r as { weightUnit?: string | null }).weightUnit ?? "" },
      { header: "Dimension L", accessor: (r) => (r as { dimensionLength?: number | null }).dimensionLength ?? "" },
      { header: "Dimension W", accessor: (r) => (r as { dimensionWidth?: number | null }).dimensionWidth ?? "" },
      { header: "Dimension H", accessor: (r) => (r as { dimensionHeight?: number | null }).dimensionHeight ?? "" },
      { header: "Dimension Unit", accessor: (r) => (r as { dimensionUnit?: string | null }).dimensionUnit ?? "" },
      { header: "Total Stock", accessor: (r) => r.totalStock },
      {
        header: "Warehouse",
        accessor: (r) => {
          const breakdown = (r.warehouseStock ?? []).filter(
            (w) => w.quantity > 0,
          );
          if (breakdown.length === 0) return "";
          const sorted = [...breakdown].sort(
            (a, b) =>
              b.quantity - a.quantity ||
              a.warehouseName.localeCompare(b.warehouseName),
          );
          return sorted[0].warehouseName;
        },
      },
      { header: "Image URL", accessor: (r) => r.imageUrl ?? "" },
      {
        header: "Parent Item",
        accessor: (r) =>
          r.parentItemId != null
            ? (parentInfoMap.get(r.parentItemId)?.sku ?? "")
            : "",
      },
      {
        header: "Variant Name",
        accessor: (r) => {
          if (r.parentItemId == null) return "";
          return variantLabel(r.variantOptions);
        },
      },
      {
        header: "Attribute 1",
        accessor: (r) => {
          if (r.parentItemId == null) return "";
          const axes = parentInfoMap.get(r.parentItemId)?.axes ?? [];
          const opts =
            (r.variantOptions as Record<string, string> | null) ?? {};
          return axes[0] ? (opts[axes[0]] ?? "") : "";
        },
      },
      {
        header: "Attribute 2",
        accessor: (r) => {
          if (r.parentItemId == null) return "";
          const axes = parentInfoMap.get(r.parentItemId)?.axes ?? [];
          const opts =
            (r.variantOptions as Record<string, string> | null) ?? {};
          return axes[1] ? (opts[axes[1]] ?? "") : "";
        },
      },
      {
        header: "Attribute 3",
        accessor: (r) => {
          if (r.parentItemId == null) return "";
          const axes = parentInfoMap.get(r.parentItemId)?.axes ?? [];
          const opts =
            (r.variantOptions as Record<string, string> | null) ?? {};
          return axes[2] ? (opts[axes[2]] ?? "") : "";
        },
      },
    ],
    [parentInfoMap],
  );

  const exportRows = useMemo(
    () => allItemsForOptions ?? [],
    [allItemsForOptions],
  );

  const selectedExportRows = useMemo(
    () =>
      selectedIds.size > 0
        ? (allItemsForOptions ?? []).filter((i) => selectedIds.has(i.id))
        : [],
    [allItemsForOptions, selectedIds],
  );

  const createMutation = useCreateItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["items-paginated"] });
        queryClient.invalidateQueries({ queryKey: ["items-facets"] });
        setVariantsByParent({});
        setSheetOpen(false);
        toast({ title: "Item created successfully" });
      },
    },
  });

  const updateMutation = useUpdateItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["items-paginated"] });
        queryClient.invalidateQueries({ queryKey: ["items-facets"] });
        setVariantsByParent({});
        setSheetOpen(false);
        toast({ title: "Item updated successfully" });
      },
    },
  });

  const deleteMutation = useDeleteItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["items-paginated"] });
        queryClient.invalidateQueries({ queryKey: ["items-facets"] });
        setVariantsByParent({});
        setDeleteDialogItem(null);
        toast({ title: "Item deleted successfully" });
      },
      onError: (err: unknown) => {
        const e = err as { message?: string };
        toast({
          variant: "destructive",
          title: "Could not delete item",
          description: e.message ?? "Unknown error",
        });
      },
    },
  });

  const bulkDeleteMutation = useDeleteItem();

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    setBulkDeleteConfirmOpen(false);
    Promise.allSettled(ids.map((id) => bulkDeleteMutation.mutateAsync({ id }))).then(
      (results) => {
        queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["items-paginated"] });
        setVariantsByParent({});
        const failed = results.filter((r) => r.status === "rejected").length;
        const succeeded = ids.length - failed;
        if (failed === 0) {
          toast({ title: `${succeeded} item${succeeded === 1 ? "" : "s"} deleted` });
        } else {
          toast({
            variant: "destructive",
            title: `${succeeded} deleted, ${failed} could not be deleted`,
          });
        }
      },
    );
  };

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      sku: "",
      name: "",
      description: "",
      category: "",
      brand: "",
      unit: "pcs",
      salePrice: 0,
      purchasePrice: 0,
      hsnCode: "",
      barcode: "",
      taxRate: 0,
      reorderLevel: 0,
      openingStock: 0,
      imageUrl: "",
      hasVariants: false,
      axes: "",
      isBundle: false,
      components: [],
      trackBatches: false,
      allowBackorder: false,
      maxDiscountPercent: null,
      weight: null,
      weightUnit: "g",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionUnit: "cm",
    },
  });
  const watchHasVariants = form.watch("hasVariants");
  const watchSalePrice = form.watch("salePrice");
  const watchMaxDiscountPercent = form.watch("maxDiscountPercent");
  const [maxDiscountRsStr, setMaxDiscountRsStr] = useState<string>("");
  const discountChangedByRs = useRef(false);
  const watchSku = form.watch("sku");
  const watchCategory = form.watch("category");

  // Ref tracks the last auto-computed barcode so we can detect user overrides.
  const lastAutoBarcodeRef = useRef<string>("");

  // Sync ₹ field when % or sale price changes (but not when ₹ itself was just typed).
  useEffect(() => {
    if (discountChangedByRs.current) {
      discountChangedByRs.current = false;
      return;
    }
    const pct = watchMaxDiscountPercent;
    const price = Number(watchSalePrice);
    if (pct != null && price > 0) {
      setMaxDiscountRsStr(((pct / 100) * price).toFixed(2));
    } else if (pct == null) {
      setMaxDiscountRsStr("");
    }
  }, [watchMaxDiscountPercent, watchSalePrice]);

  // Auto-generate the barcode field from SKU + category when creating a new item.
  // Only updates if the barcode is empty or still matches the last auto-value
  // (i.e. the user hasn't manually overridden it).
  useEffect(() => {
    if (editingItem) return;
    const slug = (s: string) =>
      s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const sku = slug(watchSku ?? "");
    const cat = slug(watchCategory ?? "");
    const generated = (cat ? `${cat}-${sku}` : sku).slice(0, 64);
    const current = form.getValues("barcode") ?? "";
    if (current === "" || current === lastAutoBarcodeRef.current) {
      form.setValue("barcode", generated, { shouldDirty: false, shouldValidate: false });
      lastAutoBarcodeRef.current = generated;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchSku, watchCategory, editingItem]);

  const handleEdit = async (item: Item) => {
    setEditingItem(item);
    const itemWh =
      item.warehouseStock?.find((w) => w.quantity > 0)?.warehouseId ??
      item.warehouseStock?.[0]?.warehouseId ??
      null;
    setSelectedWarehouseId(itemWh);
    // For bundles, fetch the detail so we can pre-fill the components
    // editor. For everything else the list row already has every field
    // we render in the form.
    let existingComponents: ItemFormValues["components"] = [];
    if (item.isBundle) {
      try {
        const detail = await getItem(item.id);
        existingComponents = (detail.components ?? []).map((c) => ({
          componentItemId: c.componentItemId,
          quantityPerBundle: c.quantityPerBundle,
        }));
      } catch {
        // If the fetch fails, fall back to an empty editor — the user
        // will see the validation error and can re-pick components.
      }
    }
    const itemAny = item as typeof item & {
      brand?: string | null;
      weight?: number | null;
      weightUnit?: string | null;
      dimensionLength?: number | null;
      dimensionWidth?: number | null;
      dimensionHeight?: number | null;
      dimensionUnit?: string | null;
      allowBackorder?: boolean;
      maxDiscountPercent?: number | null;
    };
    form.reset({
      sku: item.sku,
      name: item.name,
      description: item.description || "",
      category: item.category || "",
      brand: itemAny.brand || "",
      unit: item.unit,
      salePrice: item.salePrice,
      purchasePrice: item.purchasePrice,
      hsnCode: item.hsnCode || "",
      barcode: item.barcode || "",
      taxRate: item.taxRate,
      reorderLevel: item.reorderLevel,
      openingStock: 0, // Cannot update opening stock
      imageUrl: item.imageUrl ?? "",
      hasVariants: !!item.hasVariants,
      axes: axesString(item.variantOptions),
      isBundle: !!item.isBundle,
      components: existingComponents,
      trackBatches: !!item.trackBatches,
      allowBackorder: !!itemAny.allowBackorder,
      maxDiscountPercent: itemAny.maxDiscountPercent ?? null,
      weight: itemAny.weight ?? null,
      weightUnit: itemAny.weightUnit || "g",
      dimensionLength: itemAny.dimensionLength ?? null,
      dimensionWidth: itemAny.dimensionWidth ?? null,
      dimensionHeight: itemAny.dimensionHeight ?? null,
      dimensionUnit: itemAny.dimensionUnit || "cm",
    });
    setSheetOpen(true);
  };

  const handleCreate = () => {
    setEditingItem(null);
    const def = visibleWarehouses.find((w) => w.isDefault)?.id ?? visibleWarehouses[0]?.id ?? null;
    setSelectedWarehouseId(def);
    const preview = orgSkuMode === "auto" ? computePreviewSku() : "";
    setAutoSkuPreview(orgSkuMode === "auto" ? preview : null);
    form.reset({
      sku: preview,
      name: "",
      description: "",
      category: "",
      brand: "",
      unit: "pcs",
      salePrice: 0,
      purchasePrice: 0,
      hsnCode: "",
      barcode: "",
      taxRate: 18,
      reorderLevel: 5,
      openingStock: 0,
      imageUrl: "",
      hasVariants: false,
      axes: "",
      isBundle: false,
      components: [],
      trackBatches: false,
      allowBackorder: false,
      maxDiscountPercent: null,
      weight: null,
      weightUnit: "g",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionUnit: "cm",
    });
    setSheetOpen(true);
  };

  // Auto-open the create sheet when arriving via the command palette
  // with ?new=1.
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

  // Auto-open the edit sheet when arriving via the e-invoice
  // "What to fix" panel with ?focus=<id> (or any other deep link).
  // We only fire once per focus value, then strip the param so a
  // refresh doesn't re-trigger the side-effect.
  const { focusId, clear: clearFocus } = useFocusParam();
  const focusedHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (focusId == null || !allItemsForOptions) return;
    if (focusedHandledRef.current === focusId) return;
    const target = allItemsForOptions.find((i) => i.id === focusId);
    if (!target) return;
    focusedHandledRef.current = focusId;
    void handleEdit(target);
    clearFocus();
    // handleEdit/clearFocus are stable for the lifetime of this page;
    // re-run only when focusId or the loaded list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, allItemsForOptions]);

  const onSubmit = async (data: ItemFormValues) => {
    // In manual mode, SKU must not be empty (the schema is relaxed for auto mode).
    if (!editingItem && orgSkuMode !== "auto" && !data.sku.trim()) {
      form.setError("sku", { message: "SKU is required" });
      return;
    }
    const axesList = (data.axes ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const variantOptions = data.hasVariants ? { axes: axesList } : null;
    const componentsPayload = data.isBundle
      ? data.components.map((c) => ({
          componentItemId: c.componentItemId,
          quantityPerBundle: c.quantityPerBundle,
        }))
      : [];
    if (editingItem) {
      const currentWh =
        editingItem.warehouseStock?.find((w) => w.quantity > 0)?.warehouseId ??
        editingItem.warehouseStock?.[0]?.warehouseId ??
        null;
      if (selectedWarehouseId && selectedWarehouseId !== currentWh) {
        try {
          await bulkMoveWarehouse({
            ids: [editingItem.id],
            warehouseId: selectedWarehouseId,
          });
        } catch (err) {
          toast({
            variant: "destructive",
            title: "Failed to update warehouse",
            description:
              err instanceof Error ? err.message : "Unknown error",
          });
          return;
        }
      }
      const wantsVariants = !!data.hasVariants;
      const hadVariants = !!editingItem.hasVariants;
      const transitioningVariants = wantsVariants !== hadVariants;
      const includeOptions = wantsVariants;
      const wantsBundle = !!data.isBundle;
      const wasBundle = !!editingItem.isBundle;
      const transitioningBundle = wantsBundle !== wasBundle;
      // We always replace the component list when the row is a bundle
      // and we have edited rows; clearing the list happens automatically
      // when the user toggles isBundle off.
      const includeComponents = wantsBundle;
      const wantsTrackBatches = !!data.trackBatches;
      const wasTrackBatches = !!editingItem.trackBatches;
      const transitioningTrackBatches =
        wantsTrackBatches !== wasTrackBatches;
      updateMutation.mutate({
        id: editingItem.id,
        data: {
          sku: data.sku,
          name: data.name,
          description: data.description || null,
          category: data.category || null,
          brand: data.brand || null,
          unit: data.unit,
          salePrice: data.salePrice,
          purchasePrice: data.purchasePrice,
          hsnCode: data.hsnCode || null,
          barcode: data.barcode?.trim() ? data.barcode.trim() : null,
          taxRate: data.taxRate,
          reorderLevel: data.reorderLevel,
          imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
          ...(transitioningVariants ? { hasVariants: wantsVariants } : {}),
          ...(includeOptions ? { variantOptions } : {}),
          ...(transitioningBundle ? { isBundle: wantsBundle } : {}),
          ...(includeComponents ? { components: componentsPayload } : {}),
          ...(transitioningTrackBatches
            ? { trackBatches: wantsTrackBatches }
            : {}),
          allowBackorder: !!data.allowBackorder,
          maxDiscountPercent: data.maxDiscountPercent ?? null,
          weight: data.weight ?? null,
          weightUnit: data.weightUnit || "g",
          dimensionLength: data.dimensionLength ?? null,
          dimensionWidth: data.dimensionWidth ?? null,
          dimensionHeight: data.dimensionHeight ?? null,
          dimensionUnit: data.dimensionUnit || "cm",
        },
      });
    } else {
      createMutation.mutate({
        data: {
          // In auto mode the backend generates the SKU atomically; send empty string
          // so the server always assigns the next sequence number (race-condition-safe).
          sku: orgSkuMode === "auto" ? "" : data.sku,
          name: data.name,
          description: data.description || null,
          category: data.category || null,
          brand: data.brand || null,
          unit: data.unit,
          salePrice: data.salePrice,
          purchasePrice: data.purchasePrice,
          hsnCode: data.hsnCode || null,
          barcode: data.barcode?.trim() ? data.barcode.trim() : null,
          taxRate: data.taxRate,
          reorderLevel: data.reorderLevel,
          imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
          openingStock:
            data.hasVariants || data.isBundle ? 0 : data.openingStock || 0,
          openingWarehouseId:
            !data.hasVariants && !data.isBundle && selectedWarehouseId
              ? selectedWarehouseId
              : undefined,
          hasVariants: data.hasVariants,
          variantOptions,
          ...(data.isBundle
            ? { isBundle: true, components: componentsPayload }
            : {}),
          ...(data.trackBatches ? { trackBatches: true } : {}),
          ...(data.allowBackorder ? { allowBackorder: true } : {}),
          maxDiscountPercent: data.maxDiscountPercent ?? null,
          weight: data.weight ?? null,
          weightUnit: data.weightUnit || "g",
          dimensionLength: data.dimensionLength ?? null,
          dimensionWidth: data.dimensionWidth ?? null,
          dimensionHeight: data.dimensionHeight ?? null,
          dimensionUnit: data.dimensionUnit || "cm",
        },
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Items"
        description="Manage your product catalog and inventory items."
        actions={
          <div className="flex items-center gap-2">
            <Can module="items" action="import">
              <Button
                variant="outline"
                onClick={() => setBulkImportOpen(true)}
                data-testid="btn-bulk-import-items"
              >
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            </Can>
            <Can module="items" action="create">
              <Button onClick={handleCreate} data-testid="btn-create-item">
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </Can>
          </div>
        }
      />
      <BulkImportItemsDialog
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
      />
      <BulkEditItemsDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedIds={Array.from(selectedIds)}
        categoryOptions={categoryOptions}
        warehouses={visibleWarehouses}
        onSuccess={() => setSelectedIds(new Set())}
      />
      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={(o) => {
          if (!o) setScannerMode(null);
        }}
        onDetected={async (code) => {
          const mode = scannerMode;
          setScannerMode(null);
          const trimmed = code.trim();
          if (mode === "formBarcode") {
            // Populate the form field; never navigate — the user is
            // mid-edit and would lose unsaved changes otherwise.
            form.setValue("barcode", trimmed, {
              shouldDirty: true,
              shouldValidate: true,
            });
            return;
          }
          // mode === "search": resolve to an item and jump to it.
          try {
            const item = await lookupItemByCode({ code: trimmed });
            navigate(`/items/${item.id}`);
          } catch {
            // No match — drop the code into the search bar so the user
            // can verify or follow up manually.
            setSearch(trimmed);
            toast({
              title: "No item found",
              description: `Searched for "${trimmed}". Add it as a new item if needed.`,
            });
          }
        }}
      />

      <FilterBar
        search={search}
        onSearchChange={(v) => setSearch(v)}
        searchPlaceholder="Search items by name or SKU..."
        filterCount={itemFilterCount}
        onReset={clearAllItemFilters}
        activeChips={itemActiveChips}
        filterPopoverWidth="300px"
        rightSlot={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setScannerMode("search")}
              aria-label="Scan barcode"
              data-testid="btn-scan-items"
            >
              <ScanLine className="h-4 w-4" />
            </Button>
            <Select
              value={categoryFilter || "__all__"}
              onValueChange={(v) => setCategoryFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-items-category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItemUI value="__all__">All categories</SelectItemUI>
                {categoryOptions.map((c) => (
                  <SelectItemUI key={c} value={c}>{c}</SelectItemUI>
                ))}
              </SelectContent>
            </Select>
            {visibleWarehouses.length > 1 && (
              <Select
                value={warehouseFilter === "all" ? "all" : String(warehouseFilter)}
                onValueChange={(v) => setWarehouseFilter(v === "all" ? "all" : Number(v))}
              >
                <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-items-warehouse">
                  <Store className="h-4 w-4 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All warehouses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItemUI value="all">All warehouses</SelectItemUI>
                  {visibleWarehouses.map((w) => (
                    <SelectItemUI key={w.id} value={String(w.id)}>{w.name}</SelectItemUI>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        }
        filterContent={
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Brand</Label>
              <Select value={brandFilter || "__all__"} onValueChange={(v) => setBrandFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItemUI value="__all__">All brands</SelectItemUI>
                  {brandOptions.map((b) => (
                    <SelectItemUI key={b} value={b}>{b}</SelectItemUI>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Stock status</Label>
              <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as typeof stockFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItemUI value="all">All stock</SelectItemUI>
                  <SelectItemUI value="in-stock">In stock</SelectItemUI>
                  <SelectItemUI value="low-stock">Low stock</SelectItemUI>
                  <SelectItemUI value="out-of-stock">Out of stock</SelectItemUI>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Price range (₹)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Min"
                  className="h-8 text-sm"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                />
                <span className="text-muted-foreground text-xs">–</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Max"
                  className="h-8 text-sm"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                />
              </div>
            </div>
          </>
        }
      />

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2">
          <Can module="items" action="edit">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkEditOpen(true)}
              data-testid="btn-bulk-edit-items"
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit ({selectedIds.size})
            </Button>
          </Can>
          {canBulkDelete && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteConfirmOpen(true)}
              data-testid="btn-bulk-delete-items"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete ({selectedIds.size})
            </Button>
          )}
          <ReportExportButton
            filename="items"
            columns={exportColumns}
            rows={exportRows}
            selectedRows={selectedExportRows}
            hidePdf
          />
        </div>
      )}
      {selectedIds.size === 0 && (
        <div className="flex justify-end">
          <ReportExportButton
            filename="items"
            columns={exportColumns}
            rows={exportRows}
            hidePdf
          />
        </div>
      )}

      <TooltipProvider delayDuration={0}>
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px] px-2">
                <Checkbox
                  checked={
                    allVisibleIds.length > 0 &&
                    allVisibleIds.every((id) => selectedIds.has(id))
                  }
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedIds(new Set(allVisibleIds));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  aria-label="Select all items"
                  data-testid="checkbox-select-all-items"
                />
              </TableHead>
              <TableHead className="w-[64px]"></TableHead>
              <TableHead className="w-[180px]">SKU</TableHead>
              <TableHead className="w-[160px]">Barcode</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (itemsPage?.total ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center">
                  No items found.
                </TableCell>
              </TableRow>
            ) : (
              pagedTopLevel.flatMap((parent) => {
                const isParent = !!parent.hasVariants;
                const isExpanded = !!expanded[parent.id];
                const variants = isParent
                  ? variantsByParent[parent.id] ?? []
                  : [];
                const rows: React.ReactNode[] = [
                  <TableRow
                    key={parent.id}
                    data-testid={`row-item-${parent.id}`}
                  >
                    <TableCell className="px-2">
                      <Checkbox
                        checked={selectedIds.has(parent.id)}
                        onCheckedChange={(checked) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(parent.id);
                            else next.delete(parent.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${parent.name}`}
                        data-testid={`checkbox-item-${parent.id}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell>
                      <ItemThumb url={parent.imageUrl} alt={parent.name} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {isParent ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 -ml-1"
                            onClick={() => handleToggleExpand(parent.id)}
                            data-testid={`btn-expand-${parent.id}`}
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <span className="inline-block w-5" />
                        )}
                        {parent.sku}
                      </div>
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground"
                      data-testid={`text-barcode-${parent.id}`}
                    >
                      {parent.barcode || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/items/${parent.id}`}
                          className="font-medium text-primary hover:underline"
                          data-testid={`link-item-${parent.id}`}
                        >
                          {parent.name}
                        </Link>
                        {isParent && (
                          <Badge variant="outline">
                            {parent.variantCount} variant
                            {parent.variantCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {parent.isBundle && (
                          <Badge variant="outline" data-testid={`badge-bundle-${parent.id}`}>
                            Bundle
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{parent.category || "-"}</TableCell>
                    <TableCell className="text-right">
                      {isParent ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatCurrency(parent.salePrice)
                      )}
                    </TableCell>
                    <TableCell>
                      <WarehouseCell
                        item={isParent ? (() => {
                          // Aggregate child variant warehouse data into a
                          // synthetic breakdown so the parent row shows
                          // the same warehouse info as its children.
                          const variants = variantsByParent[parent.id] ?? [];
                          const byWh = new Map<number, { warehouseId: number; warehouseName: string; quantity: number; isVirtual: boolean }>();
                          for (const v of variants) {
                            for (const w of v.warehouseStock ?? []) {
                              const existing = byWh.get(w.warehouseId);
                              if (existing) {
                                existing.quantity += w.quantity;
                              } else {
                                byWh.set(w.warehouseId, { ...w });
                              }
                            }
                          }
                          return { ...parent, warehouseStock: Array.from(byWh.values()) };
                        })() : parent}
                        scopedWarehouseName={scopedWarehouseName}
                        testId={`text-warehouse-${parent.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {isParent ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        (() => {
                          const qty =
                            warehouseFilter === "all"
                              ? parent.totalStock
                              : parent.stockAtWarehouse ?? 0;
                          return (
                            <Badge
                              variant={
                                qty <= 0 || (parent.reorderLevel > 0 && qty <= parent.reorderLevel)
                                  ? "destructive"
                                  : "secondary"
                              }
                              title={
                                parent.isBundle
                                  ? "Derived from component stock"
                                  : undefined
                              }
                              data-testid={`text-stock-${parent.id}`}
                            >
                              {qty} {parent.unit}
                              {parent.isBundle ? " (derived)" : ""}
                            </Badge>
                          );
                        })()
                      )}
                    </TableCell>
                    <TableCell>
                      <Can module="items" action="edit">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              data-testid={`btn-item-menu-${parent.id}`}
                            >
                              <span className="sr-only">Open menu</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleEdit(parent)}
                              data-testid={`btn-edit-item-${parent.id}`}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => setDeleteDialogItem(parent)}
                              data-testid={`btn-delete-item-${parent.id}`}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Can>
                    </TableCell>
                  </TableRow>,
                ];
                if (isParent && isExpanded) {
                  for (const v of variants) {
                    rows.push(
                      <TableRow
                        key={`v-${v.id}`}
                        className="bg-muted/30"
                        data-testid={`row-item-${v.id}`}
                      >
                        <TableCell className="px-2">
                          <Checkbox
                            checked={selectedIds.has(v.id)}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(v.id);
                                else next.delete(v.id);
                                return next;
                              });
                            }}
                            aria-label={`Select ${v.name}`}
                            data-testid={`checkbox-item-${v.id}`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell>
                          <ItemThumb url={v.imageUrl} alt={v.name} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1 pl-6">
                            <span className="inline-block w-5" />
                            {v.sku}
                          </div>
                        </TableCell>
                        <TableCell
                          className="font-mono text-xs text-muted-foreground"
                          data-testid={`text-barcode-${v.id}`}
                        >
                          {v.barcode || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/items/${v.id}`}
                              className="font-medium text-primary hover:underline"
                              data-testid={`link-item-${v.id}`}
                            >
                              {v.name}
                            </Link>
                            {variantLabel(v.variantOptions) && (
                              <Badge variant="secondary" className="font-normal">
                                {variantLabel(v.variantOptions)}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{v.category || "-"}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(v.salePrice)}
                        </TableCell>
                        <TableCell>
                          <WarehouseCell
                            item={v}
                            scopedWarehouseName={scopedWarehouseName}
                            testId={`text-warehouse-${v.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {(() => {
                            const qty =
                              warehouseFilter === "all"
                                ? v.totalStock
                                : v.stockAtWarehouse ?? 0;
                            return (
                              <Badge
                                variant={
                                  qty <= 0 || (v.reorderLevel > 0 && qty <= v.reorderLevel)
                                    ? "destructive"
                                    : "secondary"
                                }
                                data-testid={`text-stock-${v.id}`}
                              >
                                {qty} {v.unit}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <Can module="items" action="edit">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  data-testid={`btn-item-menu-${v.id}`}
                                >
                                  <span className="sr-only">Open menu</span>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleEdit(v)}
                                  data-testid={`btn-edit-item-${v.id}`}
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-600"
                                  onClick={() => setDeleteDialogItem(v)}
                                  data-testid={`btn-delete-item-${v.id}`}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </Can>
                        </TableCell>
                      </TableRow>,
                    );
                  }
                }
                return rows;
              })
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        total={itemsPage?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={[15, 25, 50, 100]}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        itemLabel="items"
      />
      </TooltipProvider>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editingItem ? "Edit Item" : "Create Item"}
            </SheetTitle>
            <SheetDescription>
              {editingItem
                ? "Make changes to the item here."
                : "Add a new item to your inventory."}
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, () => {
                // On validation failure, scroll to the first field with an error.
                const firstError = document.querySelector(
                  "[aria-invalid='true'], .border-destructive",
                );
                firstError?.scrollIntoView({ behavior: "smooth", block: "center" });
              })}
              className="space-y-4 mt-6"
            >
              <FormField
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product image</FormLabel>
                    <FormControl>
                      <ImageUploader
                        value={field.value ?? ""}
                        onChange={(next) =>
                          field.onChange(next ?? "")
                        }
                        testId="item-image"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!editingItem?.parentItemId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">
                    Warehouse
                  </label>
                  <Select
                    value={selectedWarehouseId ? String(selectedWarehouseId) : ""}
                    onValueChange={(v) => setSelectedWarehouseId(v ? Number(v) : null)}
                  >
                    <SelectTrigger data-testid="select-item-warehouse">
                      <SelectValue placeholder="Select warehouse…" />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleWarehouses.map((w) => (
                        <SelectItemUI key={w.id} value={String(w.id)}>
                          {w.name}
                          {w.isDefault && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (default)
                            </span>
                          )}
                        </SelectItemUI>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        SKU *
                        {!editingItem && orgSkuMode === "auto" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary leading-none">
                            <Wand2 className="h-2.5 w-2.5" />
                            Auto
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        {!editingItem && orgSkuMode === "auto" ? (
                          <div className="flex gap-1.5">
                            <Input
                              {...field}
                              readOnly
                              className="bg-muted text-muted-foreground font-mono"
                              placeholder="Generating…"
                              data-testid="input-item-sku"
                            />
                            <button
                              type="button"
                              onClick={() => void refreshNextSku()}
                              disabled={skuRefreshing}
                              title="Refresh preview"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                              data-testid="btn-refresh-next-sku"
                            >
                              <RefreshCw className={`h-4 w-4 ${skuRefreshing ? "animate-spin" : ""}`} />
                            </button>
                          </div>
                        ) : (
                          <Input {...field} data-testid="input-item-sku" />
                        )}
                      </FormControl>
                      {!editingItem && orgSkuMode === "auto" && (
                        <p className="text-xs text-muted-foreground">
                          Assigned automatically on save. Preview may shift if another item is created first.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-item-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-item-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <CreatableCombobox
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          options={categoryOptions}
                          placeholder="Select or add category…"
                          searchPlaceholder="Search or add a category…"
                          emptyMessage="No categories yet."
                          testId="input-item-category"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit *</FormLabel>
                      <FormControl>
                        <CreatableCombobox
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          options={unitOptions}
                          placeholder="Select or add unit…"
                          searchPlaceholder="Search or add a unit…"
                          emptyMessage="No units found."
                          testId="input-item-unit"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl>
                      <CreatableCombobox
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={brandOptions}
                        placeholder="Select or add brand…"
                        searchPlaceholder="Search or add a brand…"
                        emptyMessage="No brands yet."
                        testId="input-item-brand"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="salePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sale Price (₹) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-item-saleprice"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="purchasePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>MRP (₹) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-item-purchaseprice"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="taxRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GST Rate (%) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          data-testid="input-item-taxrate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hsnCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>HSN Code</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          data-testid="input-item-hsncode"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Barcode</FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input
                          {...field}
                          placeholder="Scan or type the product barcode"
                          data-testid="input-item-barcode"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setScannerMode("formBarcode")}
                          aria-label="Scan barcode"
                          data-testid="btn-scan-item-barcode"
                        >
                          <ScanLine className="h-4 w-4" />
                        </Button>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Optional. The scanner matches the barcode first, then
                      the SKU.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="reorderLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Stock Level *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          data-testid="input-item-reorderlevel"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {!editingItem && !watchHasVariants && (
                  <FormField
                    control={form.control}
                    name="openingStock"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opening Stock</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            data-testid="input-item-openingstock"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {/* Weight & Dimensions */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Weight &amp; Dimensions</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="weight"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Weight</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.001"
                              placeholder="e.g. 250"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                              data-testid="input-item-weight"
                              className="flex-1"
                            />
                            <FormField
                              control={form.control}
                              name="weightUnit"
                              render={({ field: uf }) => (
                                <Select value={uf.value} onValueChange={uf.onChange}>
                                  <SelectTrigger className="w-20" data-testid="select-item-weight-unit">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItemUI value="g">g</SelectItemUI>
                                    <SelectItemUI value="kg">kg</SelectItemUI>
                                    <SelectItemUI value="lb">lb</SelectItemUI>
                                    <SelectItemUI value="oz">oz</SelectItemUI>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium leading-none">Dimensions (L × W × H)</label>
                  <div className="flex gap-2 items-center">
                    <FormField
                      control={form.control}
                      name="dimensionLength"
                      render={({ field }) => (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="L"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          data-testid="input-item-dim-l"
                          className="flex-1"
                        />
                      )}
                    />
                    <span className="text-muted-foreground">×</span>
                    <FormField
                      control={form.control}
                      name="dimensionWidth"
                      render={({ field }) => (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="W"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          data-testid="input-item-dim-w"
                          className="flex-1"
                        />
                      )}
                    />
                    <span className="text-muted-foreground">×</span>
                    <FormField
                      control={form.control}
                      name="dimensionHeight"
                      render={({ field }) => (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="H"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          data-testid="input-item-dim-h"
                          className="flex-1"
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dimensionUnit"
                      render={({ field: uf }) => (
                        <Select value={uf.value} onValueChange={uf.onChange}>
                          <SelectTrigger className="w-20" data-testid="select-item-dim-unit">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItemUI value="cm">cm</SelectItemUI>
                            <SelectItemUI value="in">in</SelectItemUI>
                            <SelectItemUI value="mm">mm</SelectItemUI>
                            <SelectItemUI value="m">m</SelectItemUI>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* Max discount fields */}
              {(showMaxDiscountPercent || showMaxDiscountAmount) && (
              <div className="grid grid-cols-2 gap-4">
                {showMaxDiscountPercent && (
                <FormField
                  control={form.control}
                  name="maxDiscountPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Discount %</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          placeholder="No limit"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const pct = e.target.value === "" ? null : Number(e.target.value);
                            field.onChange(pct);
                          }}
                          data-testid="input-max-discount-percent"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                )}
                {showMaxDiscountAmount && (
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Max Discount (₹)</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="No limit"
                    value={maxDiscountRsStr}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setMaxDiscountRsStr(raw);
                      discountChangedByRs.current = true;
                      if (raw === "") {
                        form.setValue("maxDiscountPercent", null, { shouldValidate: true });
                      } else {
                        const price = Number(watchSalePrice);
                        const rs = Number(raw);
                        if (price > 0) {
                          const pct = Math.min(100, (rs / price) * 100);
                          form.setValue("maxDiscountPercent", parseFloat(pct.toFixed(4)), { shouldValidate: true });
                        }
                      }
                    }}
                    data-testid="input-max-discount-amount"
                  />
                </div>
                )}
              </div>
              )}

              <div className="border-t pt-4 space-y-3">
                {(() => {
                  const isVariant = !!(editingItem && editingItem.parentItemId);
                  const hasChildren = !!(
                    editingItem && (editingItem.variantCount ?? 0) > 0
                  );
                  const lockHasVariants = !!editingItem && (isVariant || hasChildren);
                  const lockAxes = !!editingItem && hasChildren;
                  return (
                    <>
                      <FormField
                        control={form.control}
                        name="hasVariants"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={(v) => field.onChange(!!v)}
                                disabled={lockHasVariants}
                                data-testid="checkbox-has-variants"
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>This item has variants</FormLabel>
                              <FormDescription>
                                Variants are size/colour combinations under
                                this item. Each variant gets its own SKU,
                                prices, and stock levels.
                                {isVariant
                                  ? " This item is itself a variant of another item, so it can't have its own variants."
                                  : hasChildren
                                  ? " Delete the existing variants first to disable this."
                                  : ""}
                              </FormDescription>
                            </div>
                          </FormItem>
                        )}
                      />
                      {watchHasVariants && (
                        <FormField
                          control={form.control}
                          name="axes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Variant axes</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="Size, Color"
                                  disabled={lockAxes}
                                  data-testid="input-item-axes"
                                />
                              </FormControl>
                              <FormDescription>
                                Comma-separated list of 1-3 axis names.
                                Example: "Size, Color".
                                {lockAxes
                                  ? " Axes are locked once variants exist."
                                  : ""}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </>
                  );
                })()}
              </div>


              <div className="pt-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                  data-testid="btn-save-item"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : "Save Item"}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!deleteDialogItem}
        onOpenChange={(open) => !open && setDeleteDialogItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteDialogItem?.name}? This
              action cannot be undone. Note: Items cannot be deleted if they
              are used in sales or purchase orders, and parent items must
              have all their variants deleted first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteDialogItem &&
                deleteMutation.mutate({ id: deleteDialogItem.id })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(open) => !open && setBulkDeleteConfirmOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size} selected item
              {selectedIds.size === 1 ? "" : "s"}. Items used in orders or with
              variants cannot be deleted and will be reported as failures.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleteMutation.isPending}
            >
              Delete {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
