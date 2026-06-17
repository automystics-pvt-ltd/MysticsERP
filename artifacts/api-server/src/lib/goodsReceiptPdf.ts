// PDFKit-based Goods Receipt Note renderer.
// Layout matches the "Material Receipt Format" reference: bordered-cell
// form grid, supplier info band, line-item table, dual signature block,
// and a page footer with doc number and issue date.

import PDFDocument from "pdfkit";
import {
  COLORS,
  FONTS,
  PAGE,
  fmtDate,
  fmtQty,
  drawStatusStamp,
  type DocOrg,
} from "./pdfDesign";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GoodsReceiptPdfSupplier {
  name: string;
  gstNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface GoodsReceiptPdfLine {
  itemName: string;
  sku: string;
  orderedQty: number;
  receivedQty: number;
}

export interface GoodsReceiptPdfInput {
  org: DocOrg;
  logoBuffer: Buffer | null;
  supplier: GoodsReceiptPdfSupplier;
  warehouseName: string;
  receipt: {
    receiptNumber: string;
    receivedDate: string;
    status: string;
    notes: string | null;
  };
  po: {
    orderNumber: string;
    orderDate: string;
  };
  lines: GoodsReceiptPdfLine[];
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ROW_H = 22;       // standard form-grid row height
const DATA_ROW_H = 28;  // taller rows to show item name + SKU
const SIG_ROW_H = 60;   // signature area height
const TITLE_H = 26;     // "GOODS RECEIPT NOTE" banner height
const GRID_LABEL_W = 96; // width of the label column in form grids

const GRID_COLOR = "#aab0ba"; // border color for form cells
const HEADER_BG = "#5f6b7a";  // dark gray for title band
const SUBHDR_BG = "#8d98a5";  // lighter gray for "Details" band

// ---------------------------------------------------------------------------
// Low-level drawing helpers
// ---------------------------------------------------------------------------

/** Filled + stroked rectangle. */
function cellBox(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  fill?: string,
): void {
  if (fill) {
    doc.save().rect(x, y, w, h).fill(fill).restore();
  }
  doc.strokeColor(GRID_COLOR).lineWidth(0.5).rect(x, y, w, h).stroke();
}

/** Vertical divider rule inside a cell (no stroke-reset needed). */
function vDivider(
  doc: PDFKit.PDFDocument,
  x: number, y: number, h: number,
): void {
  doc.strokeColor(GRID_COLOR).lineWidth(0.5)
    .moveTo(x, y).lineTo(x, y + h).stroke();
}

/** Bold label text centred vertically within a cell. */
function labelCell(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number, y: number, w: number, h: number,
): void {
  doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.textPrimary)
    .text(text, x + 5, y + Math.max(0, (h - 9) / 2) + 1, {
      width: w - 8, lineBreak: false,
    });
}

/** Regular value text centred vertically within a cell. */
function valueCell(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number, y: number, w: number, h: number,
  align: "left" | "center" | "right" = "left",
): void {
  doc.font(FONTS.regular).fontSize(8.5).fillColor(COLORS.textBody)
    .text(text, x + 5, y + Math.max(0, (h - 9) / 2) + 1, {
      width: w - 8, lineBreak: false, align,
    });
}

// ---------------------------------------------------------------------------
// Form-grid helper: 2-column layout, each column = [label | value]
// Each tuple: [leftLabel, leftValue, rightLabel, rightValue]
// ---------------------------------------------------------------------------

function drawFormGrid(
  doc: PDFKit.PDFDocument,
  x: number, y: number, totalW: number,
  rows: Array<[string, string, string, string]>,
): number {
  const half = totalW / 2;
  const lw = GRID_LABEL_W;

  for (const [ll, lv, rl, rv] of rows) {
    // outer borders
    cellBox(doc, x, y, half, ROW_H);
    cellBox(doc, x + half, y, half, ROW_H);
    // label/value dividers
    vDivider(doc, x + lw, y, ROW_H);
    vDivider(doc, x + half + lw, y, ROW_H);
    // text
    labelCell(doc, ll, x, y, lw, ROW_H);
    valueCell(doc, lv, x + lw, y, half - lw, ROW_H);
    labelCell(doc, rl, x + half, y, lw, ROW_H);
    valueCell(doc, rv, x + half + lw, y, half - lw, ROW_H);
    y += ROW_H;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export async function renderGoodsReceiptPdf(
  input: GoodsReceiptPdfInput,
): Promise<Buffer> {
  const { org, logoBuffer, supplier, warehouseName, receipt, po, lines } = input;

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `Goods Receipt Note ${receipt.receiptNumber}`,
      Author: org.name,
      Subject: `GRN for PO ${po.orderNumber}`,
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const L: number = PAGE.margin;
  const R: number = doc.page.width - PAGE.margin;
  const W: number = R - L;
  let y: number = PAGE.margin;

  // ── 1. Header row: [Logo | Company name block | GRN tag] ────────────────

  const logoBoxW = 88;
  const tagW = 72;
  const nameBoxW = W - logoBoxW - tagW;
  const headerH = 44;

  // Logo cell
  cellBox(doc, L, y, logoBoxW, headerH);
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, L + 5, y + 5, { fit: [logoBoxW - 10, headerH - 10] });
    } catch { /* ignore */ }
  } else {
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
      .text("<Logo>", L + 4, y + 17, {
        width: logoBoxW - 8, align: "center", lineBreak: false,
      });
  }

  // Company name cell
  cellBox(doc, L + logoBoxW, y, nameBoxW, headerH);
  doc.font(FONTS.bold).fontSize(13).fillColor(COLORS.textPrimary)
    .text(org.name, L + logoBoxW + 8, y + 6, {
      width: nameBoxW - 16, lineBreak: false,
    });
  const addrParts: string[] = [];
  if (org.addressLine1) addrParts.push(org.addressLine1);
  if (org.addressLine2) addrParts.push(org.addressLine2);
  const cityLine = [org.city, org.state, org.postalCode].filter(Boolean).join(", ");
  if (cityLine) addrParts.push(cityLine);
  if (addrParts.length) {
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
      .text(addrParts.join("  ·  "), L + logoBoxW + 8, y + 21, {
        width: nameBoxW - 16, lineBreak: false,
      });
  }
  if (org.gstNumber) {
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
      .text(`GSTIN: ${org.gstNumber}`, L + logoBoxW + 8, y + 31, {
        width: nameBoxW - 16, lineBreak: false,
      });
  }

  // "Normal" tag cell (top-right)
  cellBox(doc, L + logoBoxW + nameBoxW, y, tagW, headerH);
  doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.textMuted)
    .text("Normal", L + logoBoxW + nameBoxW + 4, y + 17, {
      width: tagW - 8, align: "center", lineBreak: false,
    });

  y += headerH;

  // ── 2. Title band ─────────────────────────────────────────────────────────

  doc.save().rect(L, y, W, TITLE_H).fill(HEADER_BG).restore();
  doc.strokeColor(GRID_COLOR).lineWidth(0.5).rect(L, y, W, TITLE_H).stroke();
  doc.font(FONTS.bold).fontSize(12).fillColor("#ffffff")
    .text("Material Receipt Format (Goods Receipt Note)", L, y + (TITLE_H - 12) / 2 + 1, {
      width: W, align: "center", lineBreak: false,
    });
  y += TITLE_H + 10;

  // ── 3. Document info grid ─────────────────────────────────────────────────

  y = drawFormGrid(doc, L, y, W, [
    ["Organization:", org.name, "Document No:", receipt.receiptNumber],
    ["Department:", warehouseName, "Revision:", "—"],
    ["Section:", receipt.notes ?? "—", "Sheet:", "1 of 1"],
  ]);
  y += 14;

  // ── 4. Supplier info grid ─────────────────────────────────────────────────

  y = drawFormGrid(doc, L, y, W, [
    ["Supplier Name", supplier.name, "Supplier Code", supplier.gstNumber ?? "—"],
    ["Receipt Number", receipt.receiptNumber, "PO Number", po.orderNumber],
    ["Receipt Date", fmtDate(receipt.receivedDate), "PO Date", fmtDate(po.orderDate)],
  ]);
  y += 14;

  // ── 5. Details table ──────────────────────────────────────────────────────

  // Column widths — must sum to W
  const C_SNO = 30;
  const C_ORD = 72;
  const C_RCV = 72;
  const C_RMK = 120;
  const C_ITEM = W - C_SNO - C_ORD - C_RCV - C_RMK;

  const tableCols = [
    { label: "S No.", w: C_SNO, align: "center" as const },
    { label: "Name of the Material", w: C_ITEM, align: "left" as const },
    { label: "Ordered Qty", w: C_ORD, align: "center" as const },
    { label: "Received Qty", w: C_RCV, align: "center" as const },
    { label: "Remarks", w: C_RMK, align: "center" as const },
  ];

  // "Details" sub-header band
  doc.save().rect(L, y, W, 20).fill(SUBHDR_BG).restore();
  doc.strokeColor(GRID_COLOR).lineWidth(0.5).rect(L, y, W, 20).stroke();
  doc.font(FONTS.bold).fontSize(10).fillColor("#ffffff")
    .text("Details", L, y + 5, { width: W, align: "center", lineBreak: false });
  y += 20;

  // Column header row
  const COL_HDR_H = 22;
  doc.save().rect(L, y, W, COL_HDR_H).fill(COLORS.fillSubtle).restore();
  doc.strokeColor(GRID_COLOR).lineWidth(0.5).rect(L, y, W, COL_HDR_H).stroke();
  let cx = L;
  for (const col of tableCols) {
    vDivider(doc, cx, y, COL_HDR_H);
    doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.textPrimary)
      .text(col.label, cx + 4, y + (COL_HDR_H - 8) / 2 + 1, {
        width: col.w - 8, align: col.align, lineBreak: false,
      });
    cx += col.w;
  }
  y += COL_HDR_H;

  // Data rows — at least 8 rows total so the blank lines match the reference
  const MIN_ROWS = 8;
  const rowCount = Math.max(lines.length, MIN_ROWS);

  for (let i = 0; i < rowCount; i++) {
    const line = lines[i];

    // Check for page overflow
    if (y + DATA_ROW_H > doc.page.height - PAGE.margin - 30) {
      doc.addPage();
      y = PAGE.margin;
      // Redraw column headers on new page
      doc.save().rect(L, y, W, COL_HDR_H).fill(COLORS.fillSubtle).restore();
      doc.strokeColor(GRID_COLOR).lineWidth(0.5).rect(L, y, W, COL_HDR_H).stroke();
      cx = L;
      for (const col of tableCols) {
        vDivider(doc, cx, y, COL_HDR_H);
        doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.textPrimary)
          .text(col.label, cx + 4, y + (COL_HDR_H - 8) / 2 + 1, {
            width: col.w - 8, align: col.align, lineBreak: false,
          });
        cx += col.w;
      }
      y += COL_HDR_H;
    }

    const shaded = i % 2 === 1;
    if (shaded) {
      doc.save().rect(L, y, W, DATA_ROW_H).fill(COLORS.fillRow).restore();
    }
    doc.strokeColor(GRID_COLOR).lineWidth(0.4).rect(L, y, W, DATA_ROW_H).stroke();

    cx = L;
    for (let ci = 0; ci < tableCols.length; ci++) {
      const col = tableCols[ci]!;
      vDivider(doc, cx, y, DATA_ROW_H);

      if (line) {
        if (ci === 0) {
          // S No.
          doc.font(FONTS.regular).fontSize(8.5).fillColor(COLORS.textBody)
            .text(String(i + 1), cx + 4, y + (DATA_ROW_H - 9) / 2 + 1, {
              width: col.w - 8, align: "center", lineBreak: false,
            });
        } else if (ci === 1) {
          // Item name + SKU (two lines)
          doc.font(FONTS.regular).fontSize(8.5).fillColor(COLORS.textBody)
            .text(line.itemName, cx + 5, y + 6, {
              width: col.w - 10, lineBreak: false,
            });
          doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
            .text(`SKU: ${line.sku}`, cx + 5, y + 17, {
              width: col.w - 10, lineBreak: false,
            });
        } else if (ci === 2) {
          doc.font(FONTS.regular).fontSize(8.5).fillColor(COLORS.textBody)
            .text(fmtQty(line.orderedQty), cx + 4, y + (DATA_ROW_H - 9) / 2 + 1, {
              width: col.w - 8, align: "center", lineBreak: false,
            });
        } else if (ci === 3) {
          doc.font(FONTS.regular).fontSize(8.5).fillColor(COLORS.textBody)
            .text(fmtQty(line.receivedQty), cx + 4, y + (DATA_ROW_H - 9) / 2 + 1, {
              width: col.w - 8, align: "center", lineBreak: false,
            });
        }
        // ci === 4: Remarks — left blank for manual entry
      }

      cx += col.w;
    }
    y += DATA_ROW_H;
  }

  y += 18;

  // ── 6. Signature block ────────────────────────────────────────────────────

  if (y + SIG_ROW_H + ROW_H + 20 > doc.page.height - PAGE.margin - 30) {
    doc.addPage();
    y = PAGE.margin;
  }

  const sigHalf = W / 2;
  const sigLabelW = 130;

  // Row 1: Signature area
  cellBox(doc, L, y, sigHalf, SIG_ROW_H);
  vDivider(doc, L + sigLabelW, y, SIG_ROW_H);
  doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.textPrimary)
    .text("Received By:\n(Signature)", L + 6, y + 10, {
      width: sigLabelW - 10, lineBreak: true,
    });

  cellBox(doc, L + sigHalf, y, sigHalf, SIG_ROW_H);
  vDivider(doc, L + sigHalf + sigLabelW, y, SIG_ROW_H);
  doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.textPrimary)
    .text("Quality Check\nDone by:\n(Signature)", L + sigHalf + 6, y + 8, {
      width: sigLabelW - 10, lineBreak: true,
    });
  y += SIG_ROW_H;

  // Row 2: Name / Title
  cellBox(doc, L, y, sigHalf, ROW_H);
  vDivider(doc, L + sigLabelW, y, ROW_H);
  labelCell(doc, "Name/ Title:", L, y, sigLabelW, ROW_H);

  cellBox(doc, L + sigHalf, y, sigHalf, ROW_H);
  vDivider(doc, L + sigHalf + sigLabelW, y, ROW_H);
  labelCell(doc, "Name/ Title:", L + sigHalf, y, sigLabelW, ROW_H);
  y += ROW_H + 12;

  // ── 7. Page footer (drawn via bufferedPageRange) ───────────────────────────

  const issueDate = fmtDate(new Date().toISOString());

  doc.flushPages();
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - PAGE.margin + 6;

    doc.strokeColor(COLORS.border).lineWidth(0.4)
      .moveTo(PAGE.margin, fy - 5)
      .lineTo(doc.page.width - PAGE.margin, fy - 5)
      .stroke();

    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
      .text(`Document No: ${receipt.receiptNumber}`, PAGE.margin, fy, {
        width: W / 2, align: "left", lineBreak: false,
      });
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
      .text("Revision No: —", PAGE.margin, fy + 10, {
        width: W / 2, align: "left", lineBreak: false,
      });
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
      .text(`Sheet: ${i + 1} of ${range.count}`, PAGE.margin + W / 2, fy, {
        width: W / 2, align: "right", lineBreak: false,
      });
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.textMuted)
      .text(`Issue Date: ${issueDate}`, PAGE.margin + W / 2, fy + 10, {
        width: W / 2, align: "right", lineBreak: false,
      });

    doc.page.margins.bottom = savedBottom;
  }

  if (receipt.status === "cancelled") {
    drawStatusStamp(doc, "CANCELLED");
  }

  doc.end();
  return done;
}
