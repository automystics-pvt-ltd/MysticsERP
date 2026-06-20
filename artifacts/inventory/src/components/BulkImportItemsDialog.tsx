import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getListItemsQueryKey } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

interface BulkImportItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = "create" | "upsert";

type UnifiedRow = {
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  salePrice: string | null;
  purchasePrice: string | null;
  taxRate: string | null;
  hsnCode: string | null;
  barcode: string | null;
  reorderLevel: string | null;
  maxDiscountPercent: string | null;
  maxDiscountAmount: string | null;
  totalStock: string | null;
  warehouseName: string | null;
  imageUrl: string | null;
  parentSku: string | null;
  variantName: string | null;
  attr1: string | null;
  attr2: string | null;
  attr3: string | null;
  brand: string | null;
  weight: string | null;
  weightUnit: string | null;
  dimensionLength: string | null;
  dimensionWidth: string | null;
  dimensionHeight: string | null;
  dimensionUnit: string | null;
};

type UnifiedResultRow = {
  index: number;
  sku: string;
  parentSku: string;
  rowType: "simple" | "variant";
  action: "create" | "update" | "skip" | "error";
  error?: string;
};

type UnifiedImportResponse = {
  results: UnifiedResultRow[];
  counts: {
    create: number;
    update: number;
    skip: number;
    error: number;
  };
};

const TEMPLATE_HEADERS = [
  "Name",
  "SKU",
  "Description",
  "Category",
  "Brand",
  "Unit",
  "Sale Price",
  "MRP",
  "Tax Rate %",
  "HSN Code",
  "Barcode",
  "Min Stock Level",
  "Max Discount Percent",
  "Max Discount Amount",
  "Weight",
  "Weight Unit",
  "Dimension L",
  "Dimension W",
  "Dimension H",
  "Dimension Unit",
  "Total Stock",
  "Warehouse",
  "Image URL",
  "Parent Item",
  "Variant Name",
  "Attribute 1",
  "Attribute 2",
  "Attribute 3",
] as const;

const TEMPLATE_DATA = [
  // ── Row 1: Simple product ──────────────────────────────────────────
  [
    "Sample Widget",   // Name
    "WIDGET-001",      // SKU
    "A simple standalone product", // Description
    "Electronics",     // Category
    "Acme Co",         // Brand
    "pcs",             // Unit
    "199",             // Sale Price
    "249",             // MRP
    "18",              // Tax Rate %
    "3926",            // HSN Code
    "8901234567894",   // Barcode
    "10",              // Min Stock Level
    "",                // Max Discount Percent
    "",                // Max Discount Amount
    "250",             // Weight
    "g",               // Weight Unit
    "15",              // Dimension L
    "10",              // Dimension W
    "8",               // Dimension H
    "cm",              // Dimension Unit
    "50",              // Total Stock
    "Main Warehouse",  // Warehouse ← name of warehouse to assign stock
    "",                // Image URL
    "",                // Parent Item  ← blank for simple / parent rows
    "",                // Variant Name ← blank for simple / parent rows
    "",                // Attribute 1  ← blank for simple / parent rows
    "",                // Attribute 2
    "",                // Attribute 3
  ],
  // ── Row 2: Variant parent row (leave Parent Item blank) ───────────
  [
    "T-Shirt Classic", // Name
    "TSHIRT-001",      // SKU
    "",                // Description
    "Apparel",         // Category
    "",                // Brand
    "pcs",             // Unit
    "",                // Sale Price  (set per-variant)
    "",                // MRP
    "5",               // Tax Rate %
    "6109",            // HSN Code
    "",                // Barcode
    "5",               // Min Stock Level
    "",                // Max Discount Percent
    "",                // Max Discount Amount
    "",                // Weight
    "g",               // Weight Unit
    "",                // Dimension L
    "",                // Dimension W
    "",                // Dimension H
    "cm",              // Dimension Unit
    "",                // Total Stock (no stock on parent)
    "",                // Warehouse
    "",                // Image URL
    "",                // Parent Item ← BLANK — this IS the parent
    "",                // Variant Name
    "",                // Attribute 1
    "",                // Attribute 2
    "",                // Attribute 3
  ],
  // ── Row 3: Variant of TSHIRT-001 ──────────────────────────────────
  [
    "",                // Name        (auto-generated from parent + attrs)
    "TSHIRT-001-RED-S", // SKU
    "",                // Description
    "",                // Category    (inherited from parent)
    "",                // Brand
    "",                // Unit        (inherited from parent)
    "299",             // Sale Price
    "399",             // MRP
    "",                // Tax Rate %  (inherited from parent)
    "",                // HSN Code    (inherited from parent)
    "",                // Barcode     (auto-generated if blank)
    "",                // Min Stock Level
    "",                // Max Discount Percent
    "",                // Max Discount Amount
    "",                // Weight
    "g",               // Weight Unit
    "",                // Dimension L
    "",                // Dimension W
    "",                // Dimension H
    "cm",              // Dimension Unit
    "30",              // Total Stock
    "Main Warehouse",  // Warehouse
    "",                // Image URL
    "TSHIRT-001",      // Parent Item ← SKU of the parent row above
    "T-Shirt Classic Red S", // Variant Name (optional display label)
    "Red",             // Attribute 1
    "S",               // Attribute 2
    "",                // Attribute 3
  ],
  // ── Row 4: Another variant of TSHIRT-001 ──────────────────────────
  [
    "",                // Name
    "TSHIRT-001-RED-L", // SKU
    "",                // Description
    "",                // Category
    "",                // Brand
    "",                // Unit
    "299",             // Sale Price
    "399",             // MRP
    "",                // Tax Rate %
    "",                // HSN Code
    "",                // Barcode
    "",                // Min Stock Level
    "",                // Max Discount Percent
    "",                // Max Discount Amount
    "",                // Weight
    "g",               // Weight Unit
    "",                // Dimension L
    "",                // Dimension W
    "",                // Dimension H
    "cm",              // Dimension Unit
    "20",              // Total Stock
    "Main Warehouse",  // Warehouse
    "",                // Image URL
    "TSHIRT-001",      // Parent Item ← same parent SKU
    "T-Shirt Classic Red L", // Variant Name
    "Red",             // Attribute 1
    "L",               // Attribute 2
    "",                // Attribute 3
  ],
];

const MAX_ROWS = 2000;

function buildTemplateCsv(): string {
  return Papa.unparse(
    { fields: [...TEMPLATE_HEADERS], data: TEMPLATE_DATA },
    { quotes: true },
  );
}

function downloadTemplate() {
  const csv = buildTemplateCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "items-import-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADER_ALIASES: Record<string, keyof UnifiedRow> = {
  sku: "sku",
  name: "name",
  "item name": "name",
  "product name": "name",
  "variant name": "variantName",
  variantname: "variantName",
  description: "description",
  category: "category",
  unit: "unit",
  uom: "unit",
  "sale price": "salePrice",
  saleprice: "salePrice",
  "selling price": "salePrice",
  sellingprice: "salePrice",
  mrp: "purchasePrice",
  "purchase price": "purchasePrice",
  purchaseprice: "purchasePrice",
  "cost price": "purchasePrice",
  costprice: "purchasePrice",
  cost: "purchasePrice",
  "hsn code": "hsnCode",
  hsncode: "hsnCode",
  hsn: "hsnCode",
  barcode: "barcode",
  ean: "barcode",
  upc: "barcode",
  gtin: "barcode",
  "tax rate %": "taxRate",
  taxrate: "taxRate",
  "tax rate": "taxRate",
  gst: "taxRate",
  gstrate: "taxRate",
  "reorder level": "reorderLevel",
  reorderlevel: "reorderLevel",
  "min stock level": "reorderLevel",
  minstocklevel: "reorderLevel",
  reorder: "reorderLevel",
  "total stock": "totalStock",
  totalstock: "totalStock",
  stock: "totalStock",
  quantity: "totalStock",
  "opening stock": "totalStock",
  "max discount percent": "maxDiscountPercent",
  maxdiscountpercent: "maxDiscountPercent",
  maxdiscount: "maxDiscountPercent",
  "max discount amount": "maxDiscountAmount",
  "max discount rs": "maxDiscountAmount",
  maxdiscountamount: "maxDiscountAmount",
  brand: "brand",
  "brand name": "brand",
  brandname: "brand",
  make: "brand",
  manufacturer: "brand",
  weight: "weight",
  "weight unit": "weightUnit",
  weightunit: "weightUnit",
  "weight uom": "weightUnit",
  "dimension l": "dimensionLength",
  dimensionlength: "dimensionLength",
  length: "dimensionLength",
  "dimension w": "dimensionWidth",
  dimensionwidth: "dimensionWidth",
  width: "dimensionWidth",
  "dimension h": "dimensionHeight",
  dimensionheight: "dimensionHeight",
  height: "dimensionHeight",
  "dimension unit": "dimensionUnit",
  dimensionunit: "dimensionUnit",
  "dim unit": "dimensionUnit",
  "image url": "imageUrl",
  imageurl: "imageUrl",
  image: "imageUrl",
  imgurl: "imageUrl",
  warehouse: "warehouseName",
  "warehouse name": "warehouseName",
  warehousename: "warehouseName",
  "parent item": "parentSku",
  parentitem: "parentSku",
  "parent sku": "parentSku",
  parentsku: "parentSku",
  parent: "parentSku",
  "attribute 1": "attr1",
  attribute1: "attr1",
  "attr 1": "attr1",
  attr1: "attr1",
  "attribute 2": "attr2",
  attribute2: "attr2",
  "attr 2": "attr2",
  attr2: "attr2",
  "attribute 3": "attr3",
  attribute3: "attr3",
  "attr 3": "attr3",
  attr3: "attr3",
};

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  return s === "" ? null : s;
}

function buildRow(out: Partial<UnifiedRow>): UnifiedRow {
  return {
    sku: String(out.sku ?? "").trim(),
    name: String(out.name ?? "").trim(),
    description: str(out.description),
    category: str(out.category),
    unit: str(out.unit),
    salePrice: str(out.salePrice),
    purchasePrice: str(out.purchasePrice),
    taxRate: str(out.taxRate),
    hsnCode: str(out.hsnCode),
    barcode: str(out.barcode),
    reorderLevel: str(out.reorderLevel),
    maxDiscountPercent: str(out.maxDiscountPercent),
    maxDiscountAmount: str(out.maxDiscountAmount),
    totalStock: str(out.totalStock),
    warehouseName: str(out.warehouseName),
    imageUrl: str(out.imageUrl),
    parentSku: str(out.parentSku),
    variantName: str(out.variantName),
    attr1: str(out.attr1),
    attr2: str(out.attr2),
    attr3: str(out.attr3),
    brand: str(out.brand),
    weight: str(out.weight),
    weightUnit: str(out.weightUnit),
    dimensionLength: str(out.dimensionLength),
    dimensionWidth: str(out.dimensionWidth),
    dimensionHeight: str(out.dimensionHeight),
    dimensionUnit: str(out.dimensionUnit),
  };
}

function processHeadersAndData(
  headers: string[],
  rawData: Record<string, string>[],
): { rows: UnifiedRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const headerMap: Record<string, keyof UnifiedRow> = {};
  for (const h of headers) {
    const normal = normaliseHeader(h);
    const target = HEADER_ALIASES[normal];
    if (target) headerMap[h] = target;
  }
  if (!Object.values(headerMap).includes("sku")) {
    throw new Error(
      "File is missing a `SKU` column. Download the template to see the required headers.",
    );
  }
  const ignoredHeaders = headers.filter((h) => !headerMap[h]);
  if (ignoredHeaders.length > 0) {
    warnings.push(
      `Ignored unknown column${ignoredHeaders.length > 1 ? "s" : ""}: ${ignoredHeaders.join(", ")}`,
    );
  }
  const rows: UnifiedRow[] = [];
  for (const raw of rawData) {
    const out: Partial<UnifiedRow> = {};
    let touched = false;
    for (const [csvHeader, target] of Object.entries(headerMap)) {
      const value = raw[csvHeader];
      if (value !== undefined && value !== null && value !== "") touched = true;
      (out as Record<string, unknown>)[target] = value ?? "";
    }
    if (!touched) continue;
    rows.push(buildRow(out));
  }
  return { rows, warnings };
}

function parseCsvFile(
  file: File,
): Promise<{ rows: UnifiedRow[]; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        try {
          resolve(processHeadersAndData(result.meta.fields ?? [], result.data));
        } catch (err) {
          reject(err);
        }
      },
      error: (err) =>
        reject(
          new Error(
            (err as { message?: string })?.message ??
              "Failed to parse CSV file.",
          ),
        ),
    });
  });
}

function parseXlsxFile(
  file: File,
): Promise<{ rows: UnifiedRow[]; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) {
          reject(new Error("Excel file contains no sheets."));
          return;
        }
        const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(
          sheet,
          { header: 1, defval: null, blankrows: false },
        );
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(aoa.length, 10); i++) {
          const rowNorm = aoa[i].map((v) =>
            normaliseHeader(String(v ?? "")),
          );
          if (rowNorm.some((n) => HEADER_ALIASES[n] !== undefined)) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx === -1) {
          reject(
            new Error(
              "Could not find a recognised header row. Download the template to see the required columns.",
            ),
          );
          return;
        }
        const headers = aoa[headerRowIdx].map((v) =>
          String(v ?? "").trim(),
        );
        const rawData: Record<string, string>[] = aoa
          .slice(headerRowIdx + 1)
          .map((row) => {
            const obj: Record<string, string> = {};
            headers.forEach((h, i) => {
              obj[h] = String(row[i] ?? "").trim();
            });
            return obj;
          });
        resolve(processHeadersAndData(headers, rawData));
      } catch (err) {
        reject(
          err instanceof Error ? err : new Error("Failed to read Excel file."),
        );
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

export function BulkImportItemsDialog({
  open,
  onOpenChange,
}: BulkImportItemsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("upsert");
  const [results, setResults] = useState<UnifiedResultRow[] | null>(null);
  const [counts, setCounts] = useState<UnifiedImportResponse["counts"] | null>(
    null,
  );
  const [parsing, setParsing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);

  const errorRows = useMemo(
    () => results?.filter((r) => r.action === "error") ?? [],
    [results],
  );

  const simpleCount = useMemo(
    () => rows.filter((r) => !r.parentSku).length,
    [rows],
  );
  const variantCount = useMemo(
    () => rows.filter((r) => !!r.parentSku).length,
    [rows],
  );

  function reset() {
    setFileName(null);
    setRows([]);
    setWarnings([]);
    setResults(null);
    setCounts(null);
    setTopLevelError(null);
    setParsing(false);
    setValidating(false);
    setCommitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    if (committing) return;
    reset();
    onOpenChange(false);
  }

  async function handleFile(file: File) {
    setParsing(true);
    setTopLevelError(null);
    setResults(null);
    setCounts(null);
    try {
      const isXlsx =
        file.name.toLowerCase().endsWith(".xlsx") ||
        file.name.toLowerCase().endsWith(".xls");
      const { rows: parsed, warnings: parseWarnings } = await (isXlsx
        ? parseXlsxFile(file)
        : parseCsvFile(file));
      if (parsed.length === 0) {
        setTopLevelError("No data rows found in the file.");
        setRows([]);
        setWarnings(parseWarnings);
        return;
      }
      if (parsed.length > MAX_ROWS) {
        setTopLevelError(
          `Maximum ${MAX_ROWS} rows per import. Your file has ${parsed.length} rows — please split it.`,
        );
        setRows([]);
        setWarnings(parseWarnings);
        return;
      }
      setRows(parsed);
      setFileName(file.name);
      setWarnings(parseWarnings);
      await runDryRun(parsed, mode);
    } catch (err) {
      setTopLevelError(
        err instanceof Error ? err.message : "Failed to read file",
      );
      setRows([]);
    } finally {
      setParsing(false);
    }
  }

  async function runDryRun(currentRows: UnifiedRow[], currentMode: Mode) {
    setValidating(true);
    setTopLevelError(null);
    try {
      const resp = await customFetch<UnifiedImportResponse>(
        "/api/items/unified-bulk-import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: currentMode,
            dryRun: true,
            rows: currentRows,
          }),
        },
      );
      setResults(resp.results);
      setCounts(resp.counts);
    } catch (err) {
      const body = (err as { data?: UnifiedImportResponse | null })?.data;
      if (body && Array.isArray(body.results)) {
        setResults(body.results);
        setCounts(body.counts);
      } else {
        setTopLevelError(
          err instanceof Error ? err.message : "Failed to validate rows",
        );
      }
    } finally {
      setValidating(false);
    }
  }

  async function handleModeChange(next: Mode) {
    setMode(next);
    if (rows.length > 0) {
      await runDryRun(rows, next);
    }
  }

  async function handleCommit() {
    if (rows.length === 0 || validCount === 0) return;
    setCommitting(true);
    setTopLevelError(null);
    try {
      const resp = await customFetch<UnifiedImportResponse>(
        "/api/items/unified-bulk-import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, dryRun: false, rows }),
        },
      );
      setResults(resp.results);
      setCounts(resp.counts);
      const { create, update } = resp.counts;
      toast({
        title: "Items imported",
        description: `${create} created, ${update} updated.`,
      });
      queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
      reset();
      onOpenChange(false);
    } catch (err) {
      const body = (err as { data?: UnifiedImportResponse | null })?.data;
      if (body && Array.isArray(body.results)) {
        setResults(body.results);
        setCounts(body.counts);
      }
      toast({
        title: "Import failed",
        description:
          err instanceof Error ? err.message : "Unable to import items",
        variant: "destructive",
      });
    } finally {
      setCommitting(false);
    }
  }

  const hasFile = rows.length > 0;
  const validCount = (counts?.create ?? 0) + (counts?.update ?? 0);
  const canCommit = hasFile && !validating && !committing && validCount > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Import items</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file with up to {MAX_ROWS} rows. Supports
            both simple items and variant products in a single file. Rows with a{" "}
            <code className="font-mono">Parent Item</code> column are treated as
            variants.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-1">
          {/* File chooser + template */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              data-testid="input-bulk-import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing || validating || committing}
              data-testid="btn-bulk-import-choose-file"
            >
              <Upload className="mr-2 h-4 w-4" />
              {hasFile ? "Choose another file" : "Choose CSV or Excel file"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={downloadTemplate}
              data-testid="btn-bulk-import-template"
            >
              <Download className="mr-2 h-4 w-4" />
              Download template
            </Button>
            {fileName && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                <span className="font-medium text-foreground">{fileName}</span>
                <span>·</span>
                <span>{rows.length} rows</span>
                {variantCount > 0 && (
                  <span className="text-xs">
                    ({simpleCount} items, {variantCount} variants)
                  </span>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Template hint */}
          {!hasFile && (
            <Alert variant="default" className="bg-muted/50 border-muted">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-1">
                <p>
                  <strong>Simple items</strong> — fill in Name, SKU, and any
                  other fields. Leave <code>Parent Item</code> blank.
                </p>
                <p>
                  <strong>Variant products</strong> — fill{" "}
                  <code>Parent Item</code> (parent's SKU), SKU, prices, and{" "}
                  <code>Attribute 1/2/3</code> values. The parent can be
                  created in the same file — include a row with the parent's
                  Name and SKU and leave <code>Parent Item</code> blank.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Mode picker — only relevant for simple rows */}
          {hasFile && simpleCount > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                When a simple item's SKU already exists
              </Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => void handleModeChange(v as Mode)}
                className="mt-2 flex flex-col gap-1.5"
              >
                <label className="flex items-start gap-2 cursor-pointer">
                  <RadioGroupItem
                    value="create"
                    id="bulk-mode-create"
                    className="mt-1"
                  />
                  <div className="text-sm">
                    <div className="font-medium">Skip and report errors</div>
                    <div className="text-xs text-muted-foreground">
                      Rows whose SKU already exists are flagged as errors.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <RadioGroupItem
                    value="upsert"
                    id="bulk-mode-upsert"
                    className="mt-1"
                  />
                  <div className="text-sm">
                    <div className="font-medium">Update existing items</div>
                    <div className="text-xs text-muted-foreground">
                      Existing simple items are updated by SKU. Variants,
                      bundles and batch-tracked items are still rejected.
                    </div>
                  </div>
                </label>
              </RadioGroup>
            </div>
          )}

          {/* Spinners */}
          {(parsing || validating) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {parsing ? "Reading file…" : "Validating rows…"}
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {/* Top-level error */}
          {topLevelError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{topLevelError}</AlertDescription>
            </Alert>
          )}

          {/* Counts */}
          {counts && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {counts.create > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  {counts.create} to create
                </Badge>
              )}
              {counts.update > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
                  {counts.update} to update
                </Badge>
              )}
              {counts.skip > 0 && (
                <Badge variant="secondary" className="gap-1">
                  {counts.skip} skipped
                </Badge>
              )}
              {counts.error > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {counts.error} error{counts.error > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}

          {/* Partial-import advisory */}
          {counts && counts.error > 0 && validCount > 0 && (
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
                {counts.error} row{counts.error === 1 ? "" : "s"} with errors
                will be skipped — the remaining{" "}
                {validCount} valid item{validCount === 1 ? "" : "s"} can still
                be imported.
              </AlertDescription>
            </Alert>
          )}

          {/* Preview table */}
          {hasFile && results && (
            <div className="rounded-md border overflow-hidden">
              <div className="max-h-[280px] overflow-y-auto overflow-x-auto">
                <table className="w-max min-w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 w-8">#</th>
                      <th className="px-3 py-2 w-14">Type</th>
                      <th className="px-3 py-2 w-18">Status</th>
                      <th className="px-3 py-2 min-w-[200px]">Reason / Error</th>
                      <th className="px-3 py-2 whitespace-nowrap">SKU</th>
                      <th className="px-3 py-2 whitespace-nowrap">Name</th>
                      <th className="px-3 py-2 whitespace-nowrap">Parent Item</th>
                      <th className="px-3 py-2 whitespace-nowrap">Attr 1</th>
                      <th className="px-3 py-2 whitespace-nowrap">Sale Price</th>
                      <th className="px-3 py-2 whitespace-nowrap">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const row = rows[r.index - 1];
                      return (
                        <tr
                          key={r.index}
                          className={cn(
                            "border-t",
                            r.action === "error" && "bg-destructive/5",
                            r.action === "skip" && "bg-muted/30",
                          )}
                        >
                          <td className="px-3 py-2 text-muted-foreground text-xs">
                            {r.index}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] capitalize"
                            >
                              {r.rowType}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                r.action === "error"
                                  ? "destructive"
                                  : r.action === "update"
                                    ? "secondary"
                                    : r.action === "skip"
                                      ? "outline"
                                      : "default"
                              }
                              className="text-[10px] capitalize"
                            >
                              {r.action}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-xs min-w-[200px] whitespace-normal break-words">
                            {r.error ? (
                              <span className="text-destructive">{r.error}</span>
                            ) : r.action === "skip" ? (
                              <span className="text-muted-foreground">Already exists</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {r.sku || row?.sku || ""}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {r.rowType === "variant"
                              ? (row?.variantName ?? row?.name ?? "")
                              : (row?.name ?? "")}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                            {r.parentSku || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                            {row?.attr1 || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs text-right">
                            {row?.salePrice || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs text-right font-medium">
                            {row?.totalStock || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-2 border-t">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={committing}
            data-testid="btn-bulk-import-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleCommit()}
            disabled={!canCommit}
            data-testid="btn-bulk-import-commit"
          >
            {committing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : counts ? (
              errorRows.length > 0
                ? `Import ${validCount} valid item${validCount !== 1 ? "s" : ""}`
                : `Import ${validCount} item${validCount !== 1 ? "s" : ""}`
            ) : (
              `Import ${rows.length} rows`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
