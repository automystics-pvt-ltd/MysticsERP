import { useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, getListItemsQueryKey } from "@/lib/queryKeys";

interface BarcodeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedRow {
  sku: string;
  barcode: string | null;
  salePrice: string | null;
  purchasePrice: string | null;
  _rowError?: string;
}

interface ImportResult {
  updated: number;
  failed: number;
  errors: string[];
}

const TEMPLATE_HEADERS = [
  "Product Name",
  "SKU",
  "Barcode",
  "Category",
  "Sales Price",
  "MRP",
] as const;

const TEMPLATE_SAMPLE = [
  {
    "Product Name": "Sample Widget",
    SKU: "WIDGET-001",
    Barcode: "8901234567894",
    Category: "Demo",
    "Sales Price": "199",
    MRP: "249",
  },
];

function downloadTemplate() {
  const csv = Papa.unparse({
    fields: [...TEMPLATE_HEADERS],
    data: TEMPLATE_SAMPLE.map((s) => TEMPLATE_HEADERS.map((h) => s[h])),
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "barcode-import-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normaliseHeader(h: string): string {
  return h.trim().replace(/\s+/g, "").toLowerCase();
}

const HEADER_MAP: Record<string, keyof ParsedRow | "_productName" | "_category"> = {
  sku: "sku",
  name: "_productName",
  productname: "_productName",
  itemname: "_productName",
  barcode: "barcode",
  ean: "barcode",
  upc: "barcode",
  gtin: "barcode",
  category: "_category",
  salesprice: "salePrice",
  saleprice: "salePrice",
  sellingprice: "salePrice",
  mrp: "purchasePrice",
  purchaseprice: "purchasePrice",
  costprice: "purchasePrice",
};

function processHeadersAndRows(
  headers: string[],
  rawData: Record<string, string>[],
): { rows: ParsedRow[]; warnings: string[] } | { error: string } {
  const colMap: Record<string, keyof ParsedRow | "_productName" | "_category"> = {};
  for (const h of headers) {
    const target = HEADER_MAP[normaliseHeader(h)];
    if (target) colMap[h] = target;
  }

  if (!Object.values(colMap).includes("sku")) {
    return { error: "File is missing a `SKU` column. Download the template to see the required columns." };
  }

  const warnings: string[] = [];
  const ignoredHeaders = headers.filter((h) => !colMap[h]);
  if (ignoredHeaders.length > 0) {
    warnings.push(
      `Ignored unknown column${ignoredHeaders.length > 1 ? "s" : ""}: ${ignoredHeaders.join(", ")}`,
    );
  }

  const rows: ParsedRow[] = [];
  for (const raw of rawData) {
    const out: Partial<ParsedRow> = {};
    let hasValue = false;
    for (const [hdr, target] of Object.entries(colMap)) {
      const val = raw[hdr];
      if (val) hasValue = true;
      if (target === "_productName" || target === "_category") continue;
      (out as Record<string, unknown>)[target] = val || null;
    }
    if (!hasValue) continue;

    const sku = String(out.sku ?? "").trim();
    if (!sku) continue;

    let rowError: string | undefined;
    if (out.salePrice != null) {
      const n = Number(out.salePrice);
      if (!Number.isFinite(n) || n < 0) rowError = "Sales Price must be a non-negative number";
    }
    if (out.purchasePrice != null) {
      const n = Number(out.purchasePrice);
      if (!Number.isFinite(n) || n < 0) rowError = rowError ?? "MRP must be a non-negative number";
    }

    rows.push({
      sku,
      barcode: out.barcode ?? null,
      salePrice: out.salePrice ?? null,
      purchasePrice: out.purchasePrice ?? null,
      ...(rowError ? { _rowError: rowError } : {}),
    });
  }

  if (rows.length === 0) return { error: "No data rows found in the file." };
  return { rows, warnings };
}

function parseCsv(file: File): Promise<{ rows: ParsedRow[]; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = result.meta.fields ?? [];
        const out = processHeadersAndRows(headers, result.data);
        if ("error" in out) { reject(new Error(out.error)); return; }
        resolve(out);
      },
      error: (err) => reject(err),
    });
  });
}

function parseXlsx(file: File): Promise<{ rows: ParsedRow[]; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) { reject(new Error("Excel file contains no sheets.")); return; }

        // Get as array-of-arrays so we can find the real header row
        // (the export may prepend a title row like "Barcodes Export")
        const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
          header: 1,
          defval: null,
          blankrows: false,
        });

        // Find first row that contains a recognised column (e.g. "sku")
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(aoa.length, 10); i++) {
          const rowNorm = aoa[i].map((v) => normaliseHeader(String(v ?? "")));
          if (rowNorm.some((n) => HEADER_MAP[n] !== undefined)) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx === -1) {
          reject(new Error("Could not find a recognised header row in the Excel file. Download the template to see the required columns."));
          return;
        }

        const headers = aoa[headerRowIdx].map((v) => String(v ?? "").trim());
        const dataAoa = aoa.slice(headerRowIdx + 1);

        // Convert to array-of-objects keyed by header name
        const rawData: Record<string, string>[] = dataAoa.map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => {
            obj[h] = String(row[i] ?? "").trim();
          });
          return obj;
        });

        const out = processHeadersAndRows(headers, rawData);
        if ("error" in out) { reject(new Error(out.error)); return; }
        resolve(out);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to read Excel file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

export function BarcodeImportDialog({ open, onOpenChange }: BarcodeImportDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const errorRowCount = rows.filter((r) => r._rowError).length;
  const canCommit = rows.length > 0 && !parsing && !committing && errorRowCount === 0;

  function reset() {
    setFileName(null);
    setRows([]);
    setWarnings([]);
    setTopError(null);
    setResult(null);
    setParsing(false);
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
    setTopError(null);
    setResult(null);
    setRows([]);
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("File is too large (max 5 MB).");
      }
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx") ||
        file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const { rows: parsed, warnings: parseWarnings } = await (isXlsx ? parseXlsx(file) : parseCsv(file));
      if (parsed.length > 1000) {
        throw new Error(`Maximum 1000 rows per import. Your file has ${parsed.length} rows — please split it.`);
      }
      setRows(parsed);
      setFileName(file.name);
      setWarnings(parseWarnings);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Failed to read CSV file");
    } finally {
      setParsing(false);
    }
  }

  async function handleCommit() {
    if (!canCommit) return;
    setCommitting(true);
    setTopError(null);
    try {
      const payload = rows.map(({ sku, barcode, salePrice, purchasePrice }) => ({
        sku,
        barcode,
        salePrice,
        purchasePrice,
      }));
      const res = await customFetch<ImportResult>("/api/items/barcode-import", {
        method: "POST",
        body: JSON.stringify({ rows: payload }),
        headers: { "Content-Type": "application/json" },
      });
      setResult(res);
      queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
      if (res.failed === 0) {
        toast({
          title: "Import complete",
          description: `${res.updated} item${res.updated !== 1 ? "s" : ""} updated.`,
        });
        reset();
        onOpenChange(false);
      } else {
        toast({
          title: "Import finished with errors",
          description: `${res.updated} updated, ${res.failed} failed — see details below.`,
          variant: "destructive",
        });
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Import failed. Please try again.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import barcodes &amp; prices</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel (.xlsx) file to update barcode, Sales Price, and MRP for existing items.
            The <code className="font-mono">SKU</code> column is required to match items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              data-testid="input-barcode-import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing || committing}
              data-testid="btn-barcode-import-choose-file"
            >
              <Upload className="mr-2 h-4 w-4" />
              {rows.length > 0 ? "Choose another file" : "Choose CSV file"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={downloadTemplate}
              data-testid="btn-barcode-import-template"
            >
              <Download className="mr-2 h-4 w-4" />
              Download template
            </Button>
            {fileName && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                <span className="font-medium text-foreground">{fileName}</span>
                <span>·</span>
                <span>{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
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
            {parsing && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Parsing…
              </span>
            )}
          </div>

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

          {topError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{topError}</AlertDescription>
            </Alert>
          )}

          {result && result.failed > 0 && result.errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-1">
                  {result.updated} updated, {result.failed} failed:
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {result.errors.length > 20 && (
                    <li>…and {result.errors.length - 20} more</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  {rows.length - errorRowCount} valid
                </Badge>
                {errorRowCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {errorRowCount} error{errorRowCount > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <ScrollArea className="h-56 rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">SKU</th>
                      <th className="px-3 py-2 text-left font-medium">Barcode</th>
                      <th className="px-3 py-2 text-left font-medium">Sales Price</th>
                      <th className="px-3 py-2 text-left font-medium">MRP</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr
                        key={idx}
                        className={
                          r._rowError
                            ? "bg-destructive/5 text-destructive"
                            : idx % 2 === 0
                              ? "bg-background"
                              : "bg-muted/30"
                        }
                      >
                        <td className="px-3 py-1.5 font-mono">{r.sku}</td>
                        <td className="px-3 py-1.5 font-mono">{r.barcode ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">{r.salePrice ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">{r.purchasePrice ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">
                          {r._rowError ? (
                            <span className="text-destructive text-xs">{r._rowError}</span>
                          ) : (
                            <span className="text-emerald-600">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={committing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleCommit}
            disabled={!canCommit}
            data-testid="btn-barcode-import-submit"
          >
            {committing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              `Import ${rows.length > 0 ? rows.length - errorRowCount : ""} row${rows.length - errorRowCount !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
