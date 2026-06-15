import { Download } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

export type ExportColumn<T> = {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
};

type Props<T> = {
  filename: string;
  title?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  selectedRows?: T[];
  disabled?: boolean;
  meta?: { label: string; value: string }[];
  hidePdf?: boolean;
};

function safeFilename(name: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = name
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug}-${stamp}`;
}

function rowsToMatrix<T>(columns: ExportColumn<T>[], rows: T[]) {
  const headers = columns.map((c) => c.header);
  const body = rows.map((row) =>
    columns.map((c) => {
      const v = c.accessor(row);
      if (v === null || v === undefined) return "";
      return v;
    }),
  );
  return { headers, body };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function pdfSafe(v: unknown): string {
  return String(v ?? "").replace(/₹/g, "Rs.");
}

export function ReportExportButton<T>({
  filename,
  title,
  columns,
  rows,
  selectedRows,
  disabled,
  meta,
  hidePdf,
}: Props<T>) {
  const { toast } = useToast();
  const baseName = safeFilename(filename);
  const hasSelected = selectedRows && selectedRows.length > 0;

  const makeCsv = (targetRows: T[]) => {
    const { headers, body } = rowsToMatrix(columns, targetRows);
    const csv = Papa.unparse({ fields: headers, data: body });
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `${baseName}.csv`,
    );
  };

  const makeExcel = (targetRows: T[]) => {
    const { headers, body } = rowsToMatrix(columns, targetRows);
    const sheetData: (string | number)[][] = [];
    sheetData.push(headers);
    for (const r of body) sheetData.push(r as (string | number)[]);
    const sheet = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Report");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    downloadBlob(
      new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${baseName}.xlsx`,
    );
  };

  const makePdf = (targetRows: T[]) => {
    const { headers, body } = rowsToMatrix(columns, targetRows);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;

    const AMBER_R = 193, AMBER_G = 127, AMBER_B = 38;
    const DARK_R  = 25,  DARK_G  = 25,  DARK_B  = 25;
    const GRAY_R  = 110, GRAY_G  = 110, GRAY_B  = 110;
    const LIGHT_R = 252, LIGHT_G = 248, LIGHT_B = 240;

    doc.setFillColor(AMBER_R, AMBER_G, AMBER_B);
    doc.rect(0, 0, pageW, 56, "F");
    doc.setFillColor(160, 100, 20);
    doc.rect(0, 0, pageW, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text("MM Wear ERP", margin, 36);
    if (title) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(255, 240, 200);
      doc.text(pdfSafe(title), pageW - margin, 36, { align: "right" });
    }
    doc.setFillColor(245, 245, 245);
    doc.rect(0, 56, pageW, 22, "F");
    doc.setFillColor(220, 220, 220);
    doc.rect(0, 77, pageW, 0.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(GRAY_R, GRAY_G, GRAY_B);
    const dateStr = new Date().toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    doc.text(`Generated: ${dateStr}`, margin, 71);
    doc.text("Confidential — MM Wear Internal Use Only", pageW - margin, 71, { align: "right" });

    let cursorY = 98;
    if (meta && meta.length > 0) {
      const cardGap = 10;
      const cardW = (pageW - margin * 2 - cardGap * (meta.length - 1)) / meta.length;
      const cardH = 42;
      for (let i = 0; i < meta.length; i++) {
        const bx = margin + i * (cardW + cardGap);
        doc.setFillColor(LIGHT_R, LIGHT_G, LIGHT_B);
        doc.setDrawColor(220, 185, 110);
        doc.setLineWidth(0.6);
        doc.roundedRect(bx, cursorY, cardW, cardH, 3, 3, "FD");
        doc.setFillColor(AMBER_R, AMBER_G, AMBER_B);
        doc.roundedRect(bx, cursorY, 4, cardH, 2, 2, "F");
        doc.rect(bx + 2, cursorY, 2, cardH, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(GRAY_R, GRAY_G, GRAY_B);
        doc.text(meta[i].label.toUpperCase(), bx + 12, cursorY + 14);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(DARK_R, DARK_G, DARK_B);
        doc.text(pdfSafe(meta[i].value), bx + 12, cursorY + 30);
      }
      cursorY += cardH + 14;
    }
    doc.setDrawColor(AMBER_R, AMBER_G, AMBER_B);
    doc.setLineWidth(1);
    doc.line(margin, cursorY, pageW - margin, cursorY);
    cursorY += 8;
    autoTable(doc, {
      head: [headers],
      body: body.map((r) => r.map((cell) => pdfSafe(cell))),
      startY: cursorY,
      styles: {
        fontSize: 9, font: "helvetica",
        cellPadding: { top: 5, bottom: 5, left: 7, right: 7 },
        textColor: [DARK_R, DARK_G, DARK_B],
        lineColor: [225, 225, 225], lineWidth: 0.3,
      },
      headStyles: {
        fillColor: [DARK_R, DARK_G, DARK_B], textColor: [255, 255, 255],
        fontStyle: "bold", fontSize: 9,
        cellPadding: { top: 6, bottom: 6, left: 7, right: 7 },
      },
      alternateRowStyles: { fillColor: [LIGHT_R, LIGHT_G, LIGHT_B] },
      margin: { left: margin, right: margin, bottom: 40 },
      didDrawPage: (data) => {
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.4);
        doc.line(margin, pageH - 30, pageW - margin, pageH - 30);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(GRAY_R, GRAY_G, GRAY_B);
        doc.text("MM Wear ERP", margin, pageH - 18);
        if (title) doc.text(pdfSafe(title), pageW / 2, pageH - 18, { align: "center" });
        doc.text(`Page ${data.pageNumber}`, pageW - margin, pageH - 18, { align: "right" });
      },
    });
    doc.save(`${baseName}.pdf`);
  };

  const guard = (handler: () => void, label: string, targetRows: T[]) => () => {
    if (!targetRows || targetRows.length === 0) {
      toast({
        title: "Nothing to export",
        description: "There are no rows to include in the export.",
        variant: "destructive",
      });
      return;
    }
    try {
      handler();
    } catch (err) {
      toast({
        title: `${label} export failed`,
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid="button-export-report"
        >
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {hasSelected && (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground pb-1">
              Export selected ({selectedRows.length})
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={guard(() => makeCsv(selectedRows), "CSV", selectedRows)}
              data-testid="menu-export-selected-csv"
            >
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={guard(() => makeExcel(selectedRows), "Excel", selectedRows)}
              data-testid="menu-export-selected-excel"
            >
              Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground pb-1">
              Export all
            </DropdownMenuLabel>
          </>
        )}
        {!hidePdf && (
          <DropdownMenuItem
            onSelect={guard(() => makePdf(rows), "PDF", rows)}
            data-testid="menu-export-pdf"
          >
            PDF
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={guard(() => makeExcel(rows), "Excel", rows)}
          data-testid="menu-export-excel"
        >
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={guard(() => makeCsv(rows), "CSV", rows)}
          data-testid="menu-export-csv"
        >
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
