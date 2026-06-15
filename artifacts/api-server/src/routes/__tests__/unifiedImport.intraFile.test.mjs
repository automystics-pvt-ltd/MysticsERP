/**
 * Smoke test for intra-file parent detection in unified bulk import.
 *
 * Runs as a plain Node.js script (no test runner needed) so it can be
 * executed against the compiled bundle without auth or a live DB.
 *
 * The test re-implements the exact parsing + intra-file-detection algorithm
 * that lives in unifiedImport.ts so we can verify correctness in isolation.
 */

// ── Helpers (mirrors unifiedImport.ts) ────────────────────────────────────
function fStr(v) {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}
function oStr(v) {
  const s = fStr(v);
  return s === "" ? null : s;
}
function pNum(v, fallback = 0) {
  if (v == null || v === "") return { ok: true, value: fallback };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

// ── Simulate row parsing ───────────────────────────────────────────────────
function parseRows(rawRows, mode = "create") {
  const results = [];
  const simpleParsed = [];
  const variantParsed = [];
  const simpleResultIdx = [];
  const variantResultIdx = [];
  const seenSkus = new Map();

  for (let i = 0; i < rawRows.length; i++) {
    const idx = i + 1;
    const r = rawRows[i] ?? {};
    const sku = fStr(r.sku);
    const parentSku = fStr(r.parentSku);
    const isVariant = parentSku.length > 0;

    const fail = (error) => {
      results.push({ index: idx, sku, parentSku, rowType: isVariant ? "variant" : "simple", action: "error", error });
      if (isVariant) { variantParsed.push(null); variantResultIdx.push(results.length - 1); }
      else { simpleParsed.push(null); simpleResultIdx.push(results.length - 1); }
    };

    if (!sku) { fail("SKU is required"); continue; }
    const seenAt = seenSkus.get(sku);
    if (seenAt != null) { fail(`Duplicate SKU (also on row ${seenAt})`); continue; }
    seenSkus.set(sku, idx);

    if (isVariant) {
      const saleP = pNum(r.salePrice);
      if (!saleP.ok) { fail("Sale Price is not a valid number"); continue; }
      const purchP = pNum(r.purchasePrice);
      if (!purchP.ok) { fail("MRP is not a valid number"); continue; }
      variantParsed.push({
        index: idx, parentSku, sku,
        variantName: fStr(r.variantName),
        barcode: oStr(r.barcode),
        salePrice: saleP.value, purchasePrice: purchP.value,
        totalStock: (r.totalStock != null && r.totalStock !== "") ? pNum(r.totalStock).value : null,
        attr1: fStr(r.attr1), attr2: fStr(r.attr2), attr3: fStr(r.attr3),
      });
      variantResultIdx.push(results.length);
      results.push({ index: idx, sku, parentSku, rowType: "variant", action: "create" });
    } else {
      const name = fStr(r.name);
      if (!name) { fail("Name is required"); continue; }
      const saleP = pNum(r.salePrice);
      if (!saleP.ok) { fail("Sale Price is not a number"); continue; }
      const taxP = pNum(r.taxRate);
      if (!taxP.ok) { fail("Tax Rate is not a number"); continue; }
      simpleParsed.push({
        index: idx, sku, name,
        description: oStr(r.description), category: oStr(r.category),
        unit: fStr(r.unit) || "pcs", barcode: oStr(r.barcode),
        salePrice: saleP.value, purchasePrice: pNum(r.purchasePrice).value,
        hsnCode: oStr(r.hsnCode), taxRate: taxP.value,
        reorderLevel: pNum(r.reorderLevel).value,
        imageUrl: null, totalStock: null,
        maxDiscountPercent: null, maxDiscountAmount: null,
      });
      simpleResultIdx.push(results.length);
      results.push({ index: idx, sku, parentSku: "", rowType: "simple", action: "create" });
    }
  }

  return { results, simpleParsed, variantParsed, simpleResultIdx, variantResultIdx };
}

// ── Simulate intra-file parent detection ─────────────────────────────────
function detectIntraFileParents(simpleParsed, variantParsed, dbParentMap) {
  const parentMap = new Map(dbParentMap);

  const simpleParsedBySkuIdx = new Map();
  for (let j = 0; j < simpleParsed.length; j++) {
    const sp = simpleParsed[j];
    if (sp) simpleParsedBySkuIdx.set(sp.sku, j);
  }

  const intraFileParentSkus = new Set();
  for (const vp of variantParsed) {
    if (!vp || parentMap.has(vp.parentSku)) continue;
    if (!simpleParsedBySkuIdx.has(vp.parentSku)) continue;
    intraFileParentSkus.add(vp.parentSku);
  }

  const intraFileParentAxes = new Map();
  for (const pSku of intraFileParentSkus) {
    let hasAttr1 = false, hasAttr2 = false, hasAttr3 = false;
    for (const vp of variantParsed) {
      if (!vp || vp.parentSku !== pSku) continue;
      if (vp.attr1) hasAttr1 = true;
      if (vp.attr2) hasAttr2 = true;
      if (vp.attr3) hasAttr3 = true;
    }
    const axes = [];
    if (hasAttr1 || (!hasAttr2 && !hasAttr3)) axes.push("Attribute 1");
    if (hasAttr2) axes.push("Attribute 2");
    if (hasAttr3) axes.push("Attribute 3");
    intraFileParentAxes.set(pSku, axes);

    const sp = simpleParsed[simpleParsedBySkuIdx.get(pSku)];
    parentMap.set(pSku, {
      id: -1,
      name: sp.name, sku: sp.sku,
      hasVariants: true, axes,
      unit: sp.unit, category: sp.category,
      hsnCode: sp.hsnCode, taxRate: String(sp.taxRate),
    });
  }

  return { parentMap, intraFileParentSkus, intraFileParentAxes };
}

// ── Test cases ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nTest 1: Template file — parent + variants in same file");
{
  const rows = [
    // Row 1: simple product
    { name: "Sample Widget", sku: "WIDGET-001", salePrice: "199", unit: "pcs", taxRate: "18" },
    // Row 2: parent item (Parent Item blank → simple row)
    { name: "T-Shirt Classic", sku: "TSHIRT-001", salePrice: "", taxRate: "5", hsnCode: "6109", unit: "pcs" },
    // Row 3: variant referencing TSHIRT-001
    { sku: "TSHIRT-001-RED-S", parentSku: "TSHIRT-001", salePrice: "299", purchasePrice: "399", attr1: "Red", attr2: "S", totalStock: "30" },
    // Row 4: variant referencing TSHIRT-001
    { sku: "TSHIRT-001-RED-L", parentSku: "TSHIRT-001", salePrice: "299", purchasePrice: "399", attr1: "Red", attr2: "L", totalStock: "20" },
  ];

  const { simpleParsed, variantParsed, results } = parseRows(rows);
  assert("WIDGET-001 parsed as simple/create", simpleParsed[0]?.sku === "WIDGET-001");
  assert("TSHIRT-001 parsed as simple/create (blank sale price is OK)", simpleParsed[1]?.sku === "TSHIRT-001");
  assert("TSHIRT-001-RED-S parsed as variant/create", variantParsed[0]?.sku === "TSHIRT-001-RED-S");
  assert("TSHIRT-001-RED-L parsed as variant/create", variantParsed[1]?.sku === "TSHIRT-001-RED-L");

  // Simulate: TSHIRT-001 not in DB
  const dbParentMap = new Map();
  const { parentMap, intraFileParentSkus, intraFileParentAxes } = detectIntraFileParents(simpleParsed, variantParsed, dbParentMap);

  assert("TSHIRT-001 detected as intra-file parent", intraFileParentSkus.has("TSHIRT-001"));
  assert("parentMap contains TSHIRT-001 with id=-1", parentMap.get("TSHIRT-001")?.id === -1);
  assert("parentMap hasVariants=true for TSHIRT-001", parentMap.get("TSHIRT-001")?.hasVariants === true);
  assert("axes derived: Attribute 1 (Red) + Attribute 2 (S/L)", JSON.stringify(intraFileParentAxes.get("TSHIRT-001")) === JSON.stringify(["Attribute 1", "Attribute 2"]));
  assert("WIDGET-001 NOT treated as intra-file parent", !intraFileParentSkus.has("WIDGET-001"));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nTest 2: Parent already in DB — intra-file detection skips it");
{
  const rows = [
    { name: "T-Shirt Classic", sku: "TSHIRT-001", salePrice: "", taxRate: "5", unit: "pcs" },
    { sku: "TSHIRT-001-RED-S", parentSku: "TSHIRT-001", salePrice: "299", purchasePrice: "399", attr1: "Red", totalStock: "10" },
  ];
  const { simpleParsed, variantParsed } = parseRows(rows);

  // Simulate: TSHIRT-001 already in DB with hasVariants=true
  const dbParentMap = new Map([
    ["TSHIRT-001", { id: 42, name: "T-Shirt Classic", sku: "TSHIRT-001", hasVariants: true, axes: ["Color"], unit: "pcs", category: null, hsnCode: null, taxRate: "5" }],
  ]);
  const { parentMap, intraFileParentSkus } = detectIntraFileParents(simpleParsed, variantParsed, dbParentMap);

  assert("TSHIRT-001 NOT in intraFileParentSkus (already in DB)", !intraFileParentSkus.has("TSHIRT-001"));
  assert("parentMap retains DB id=42", parentMap.get("TSHIRT-001")?.id === 42);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nTest 3: Variant with no valid parent anywhere → stays as error");
{
  const rows = [
    { sku: "SHIRT-RED", parentSku: "GHOST-SKU", salePrice: "199", purchasePrice: "249", attr1: "Red", totalStock: "5" },
  ];
  const { simpleParsed, variantParsed } = parseRows(rows);

  const { parentMap, intraFileParentSkus } = detectIntraFileParents(simpleParsed, variantParsed, new Map());

  assert("GHOST-SKU not in intraFileParentSkus", !intraFileParentSkus.has("GHOST-SKU"));
  assert("parentMap does not contain GHOST-SKU", !parentMap.has("GHOST-SKU"));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nTest 4: Only attr1 used → single axis derived");
{
  const rows = [
    { name: "Mug", sku: "MUG-001", salePrice: "", taxRate: "0", unit: "pcs" },
    { sku: "MUG-001-RED", parentSku: "MUG-001", salePrice: "99", purchasePrice: "120", attr1: "Red", totalStock: "15" },
    { sku: "MUG-001-BLUE", parentSku: "MUG-001", salePrice: "99", purchasePrice: "120", attr1: "Blue", totalStock: "15" },
  ];
  const { simpleParsed, variantParsed } = parseRows(rows);
  const { intraFileParentAxes } = detectIntraFileParents(simpleParsed, variantParsed, new Map());

  assert("Single axis derived when only attr1 is used", JSON.stringify(intraFileParentAxes.get("MUG-001")) === JSON.stringify(["Attribute 1"]));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("\nTest 5: Parent row has parse error → should NOT be in intraFileParentSkus");
{
  const rows = [
    // No name → will fail → simpleParsed[0] = null
    { name: "", sku: "BAD-PARENT", salePrice: "", taxRate: "0", unit: "pcs" },
    { sku: "VAR-001", parentSku: "BAD-PARENT", salePrice: "99", purchasePrice: "120", attr1: "Red", totalStock: "5" },
  ];
  const { simpleParsed, variantParsed } = parseRows(rows);

  assert("BAD-PARENT simple entry is null (parse error)", simpleParsed[0] === null);

  const { parentMap, intraFileParentSkus } = detectIntraFileParents(simpleParsed, variantParsed, new Map());

  assert("BAD-PARENT NOT in intraFileParentSkus (null entry)", !intraFileParentSkus.has("BAD-PARENT"));
  assert("parentMap does not contain BAD-PARENT", !parentMap.has("BAD-PARENT"));
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
