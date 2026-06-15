import { useMemo, useRef, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListItems,
  useListWarehouses,
  useCreateStockTransfer,
  getListStockTransfersQueryKey,
} from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ParsedRow = {
  rowIndex: number;
  sku: string;
  quantity: number;
  itemId: number | null;
  itemName: string | null;
  stockAtWarehouse: number | null;
  error: string | null;
};

type Step = "configure" | "preview" | "done";

const TEMPLATE_HEADERS = ["Item SKU", "Quantity"];
const TEMPLATE_DATA = [
  ["TSHIRT-RED-S", "10"],
  ["DENIM-BLUE-32", "5"],
  ["CAP-BLACK", "20"],
];

const MAX_ROWS = 500;

function buildTemplateXlsx(): ArrayBuffer {
  const sheetData = [TEMPLATE_HEADERS, ...TEMPLATE_DATA];
  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Transfer");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function downloadTemplate() {
  const buf = buildTemplateXlsx();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "stock-transfer-import-template.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseRawRows(raw: string[][]): Array<{ sku: string; quantityRaw: string }> {
  if (raw.length === 0) return [];
  const firstRow = raw[0].map((c) => String(c ?? "").trim().toLowerCase());
  const hasHeader =
    firstRow.includes("item sku") ||
    firstRow.includes("sku") ||
    firstRow.includes("quantity");
  const dataRows = hasHeader ? raw.slice(1) : raw;
  return dataRows
    .filter((r) => r.some((c) => String(c ?? "").trim()))
    .map((r) => ({
      sku: String(r[0] ?? "").trim(),
      quantityRaw: String(r[1] ?? "").trim(),
    }));
}

export function BulkImportStockTransferDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("configure");
  const [fromWarehouseId, setFromWarehouseId] = useState<string>("");
  const [toWarehouseId, setToWarehouseId] = useState<string>("");
  const [transferDate, setTransferDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [notes, setNotes] = useState("");
  const [resultMessage, setResultMessage] = useState("");

  const { data: warehouses } = useListWarehouses();
  const { data: allItems } = useListItems(
    fromWarehouseId ? { warehouseId: Number(fromWarehouseId) } : {},
  );

  const skuMap = useMemo(() => {
    const m = new Map<string, { id: number; name: string; stockAtWarehouse: number | null }>();
    for (const item of allItems ?? []) {
      m.set(item.sku.toLowerCase(), {
        id: item.id,
        name: item.name,
        stockAtWarehouse: item.stockAtWarehouse ?? null,
      });
    }
    return m;
  }, [allItems]);

  const createMutation = useCreateStockTransfer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStockTransfersQueryKey() });
        setResultMessage("Stock transfer created successfully.");
        setStep("done");
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string }; message?: string };
        toast({
          title: "Import failed",
          description: e.data?.error ?? "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const handleFile = (file: File) => {
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
        processRawRows(raw as string[][]);
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse<string[]>(file, {
        complete: (res) => processRawRows(res.data),
        skipEmptyLines: true,
      });
    }
  };

  const processRawRows = (raw: string[][]) => {
    const extracted = parseRawRows(raw).slice(0, MAX_ROWS);
    if (extracted.length === 0) {
      toast({ title: "No rows found in file", variant: "destructive" });
      return;
    }
    const rows: ParsedRow[] = extracted.map((r, i) => {
      if (!r.sku) {
        return { rowIndex: i + 2, sku: r.sku, quantity: 0, itemId: null, itemName: null, stockAtWarehouse: null, error: "SKU is empty" };
      }
      const qty = Number(r.quantityRaw);
      if (!r.quantityRaw || !Number.isFinite(qty) || qty <= 0) {
        return { rowIndex: i + 2, sku: r.sku, quantity: 0, itemId: null, itemName: null, stockAtWarehouse: null, error: "Quantity must be a positive number" };
      }
      const resolved = skuMap.get(r.sku.toLowerCase());
      if (!resolved) {
        return { rowIndex: i + 2, sku: r.sku, quantity: qty, itemId: null, itemName: null, stockAtWarehouse: null, error: fromWarehouseId ? "SKU not found in source warehouse" : "SKU not found" };
      }
      const available = resolved.stockAtWarehouse ?? 0;
      if (available < qty) {
        return {
          rowIndex: i + 2,
          sku: r.sku,
          quantity: qty,
          itemId: resolved.id,
          itemName: resolved.name,
          stockAtWarehouse: available,
          error: `Insufficient stock: need ${qty}, available ${available}`,
        };
      }
      return { rowIndex: i + 2, sku: r.sku, quantity: qty, itemId: resolved.id, itemName: resolved.name, stockAtWarehouse: available, error: null };
    });
    setParsedRows(rows);
    setStep("preview");
  };

  const validRows = parsedRows.filter((r) => !r.error);
  const errorRows = parsedRows.filter((r) => r.error);

  const handleSubmit = () => {
    if (validRows.length === 0) return;
    createMutation.mutate({
      data: {
        fromWarehouseId: Number(fromWarehouseId),
        toWarehouseId: Number(toWarehouseId),
        transferDate,
        notes: notes.trim() || null,
        lines: validRows.map((r) => ({ itemId: r.itemId!, quantity: r.quantity })),
      },
    });
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep("configure");
      setFromWarehouseId("");
      setToWarehouseId("");
      setTransferDate(format(new Date(), "yyyy-MM-dd"));
      setFileName(null);
      setParsedRows([]);
      setNotes("");
      setResultMessage("");
    }, 300);
  };

  const canProceedToConfigure =
    fromWarehouseId && toWarehouseId && fromWarehouseId !== toWarehouseId && transferDate;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Stock Transfer</DialogTitle>
          <DialogDescription>
            Upload a spreadsheet to create a new stock transfer from multiple items.
          </DialogDescription>
        </DialogHeader>

        {step === "configure" && (
          <div className="flex-1 overflow-y-auto space-y-5 py-2">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Download template
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>From Warehouse *</Label>
                <Select value={fromWarehouseId} onValueChange={(v) => { setFromWarehouseId(v); setParsedRows([]); setFileName(null); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Source warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses?.map((w) => (
                      <SelectItem key={w.id} value={w.id.toString()}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>To Warehouse *</Label>
                <Select
                  value={toWarehouseId}
                  onValueChange={setToWarehouseId}
                  disabled={!fromWarehouseId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Destination warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses
                      ?.filter((w) => w.id.toString() !== fromWarehouseId)
                      .map((w) => (
                        <SelectItem key={w.id} value={w.id.toString()}>
                          {w.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Transfer Date *</Label>
                <Input
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input
                  placeholder="Optional notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Upload file (CSV or Excel)</Label>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  canProceedToConfigure
                    ? "border-muted-foreground/30 hover:border-primary/50"
                    : "border-muted/40 opacity-50 cursor-not-allowed",
                )}
                onClick={() => canProceedToConfigure && fileInputRef.current?.click()}
              >
                <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                {fileName ? (
                  <p className="text-sm font-medium">{fileName}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      {canProceedToConfigure ? "Click to upload" : "Select warehouses and date first"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      CSV or Excel (.xlsx) — columns: Item SKU, Quantity
                    </p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".csv,.xlsx,.xls"
                  disabled={!canProceedToConfigure}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            <div className="flex gap-3 flex-wrap">
              <Badge variant="secondary" className="text-green-700 bg-green-50">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                {validRows.length} valid
              </Badge>
              {errorRows.length > 0 && (
                <Badge variant="secondary" className="text-red-700 bg-red-50">
                  <AlertCircle className="h-3.5 w-3.5 mr-1" />
                  {errorRows.length} error{errorRows.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {errorRows.length > 0 && (
              <Alert variant="destructive" className="py-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Rows with errors will be skipped. Fix the file and re-upload to include them.
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Row</th>
                    <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">SKU</th>
                    <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Item</th>
                    <th className="text-right px-3 py-2 font-medium text-xs text-muted-foreground">In Stock</th>
                    <th className="text-right px-3 py-2 font-medium text-xs text-muted-foreground">Transfer Qty</th>
                    <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((r) => (
                    <tr
                      key={r.rowIndex}
                      className={cn(
                        "border-t",
                        r.error ? "bg-red-50/40" : "hover:bg-muted/30",
                      )}
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.rowIndex}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.sku || <span className="text-muted-foreground italic">empty</span>}</td>
                      <td className="px-3 py-2 text-xs">{r.itemName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-right">
                        {r.stockAtWarehouse !== null ? (
                          <span className={r.stockAtWarehouse === 0 ? "text-red-600 font-medium" : "text-muted-foreground"}>
                            {r.stockAtWarehouse}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-right">{r.quantity > 0 ? r.quantity : "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.error ? (
                          <span className="text-red-600 flex items-center gap-1">
                            <X className="h-3 w-3 shrink-0" />
                            {r.error}
                          </span>
                        ) : (
                          <span className="text-green-700 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex-1 flex flex-col items-center justify-center py-8 gap-4">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <p className="text-base font-medium">{resultMessage}</p>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          {step === "configure" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canProceedToConfigure}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload file
              </Button>
            </>
          )}

          {step === "preview" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("configure");
                  setParsedRows([]);
                  setFileName(null);
                }}
              >
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={validRows.length === 0 || createMutation.isPending}
              >
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create transfer ({validRows.length} item{validRows.length !== 1 ? "s" : ""})
              </Button>
            </>
          )}

          {step === "done" && (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
