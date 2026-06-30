// Coverage for the Warehouse picker + per-warehouse Stock columns on
// the Items page. The picker defaults to "All warehouses" and each
// non-virtual warehouse gets its own column. Every row shows stock qty
// for that warehouse (0 when absent). Switching the picker to a
// specific warehouse filters which items appear; the per-warehouse
// columns themselves always show all-warehouse stock.

import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

// jsdom has neither ResizeObserver nor PointerEvent; both are touched
// by the radix Select primitive used by the warehouse picker. The
// minimal stubs below let the picker open without crashing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (
  typeof (globalThis as unknown as { PointerEvent?: unknown }).PointerEvent ===
  "undefined"
) {
  class PointerEventStub extends MouseEvent {
    pointerId = 0;
    pointerType = "mouse";
    width = 1;
    height = 1;
    pressure = 0;
    tangentialPressure = 0;
    tiltX = 0;
    tiltY = 0;
    twist = 0;
    isPrimary = true;
  }
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent =
    PointerEventStub;
}
if (
  typeof (Element.prototype as unknown as { hasPointerCapture?: unknown })
    .hasPointerCapture === "undefined"
) {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture =
    () => false;
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture =
    () => undefined;
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
    () => undefined;
}
if (
  typeof (Element.prototype as unknown as { scrollIntoView?: unknown })
    .scrollIntoView === "undefined"
) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
    () => undefined;
}

type Warehouse = { id: number; name: string; isVirtual: boolean };
type WarehouseStockEntry = {
  warehouseId: number;
  warehouseName: string;
  quantity: number;
};
type Item = {
  id: number;
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  unit: string;
  salePrice: number;
  reorderLevel: number;
  totalStock: number;
  stockAtWarehouse: number | null;
  warehouseStock: WarehouseStockEntry[] | null;
  hasVariants: boolean;
  isBundle: boolean;
  parentItemId: number | null;
  variantOptions: Record<string, unknown> | null;
  variantCount: number;
  imageUrl: string | null;
  description: string | null;
  hsnCode: string | null;
  taxRate: number;
  purchasePrice: number;
  trackBatches: boolean;
  barcodeSource: "auto" | "manual" | null;
};

const WH_MAIN: Warehouse = { id: 1, name: "Main Warehouse", isVirtual: false };
const WH_NORTH: Warehouse = { id: 2, name: "North Depot", isVirtual: false };
const WH_VIRTUAL: Warehouse = {
  id: 3,
  name: "Job Worker Co",
  isVirtual: true,
};

function makeItem(overrides: Partial<Item>): Item {
  return {
    id: 0,
    sku: "SKU",
    name: "Item",
    barcode: null,
    category: null,
    unit: "ea",
    salePrice: 0,
    reorderLevel: 0,
    totalStock: 0,
    stockAtWarehouse: null,
    warehouseStock: null,
    hasVariants: false,
    isBundle: false,
    parentItemId: null,
    variantOptions: null,
    variantCount: 0,
    imageUrl: null,
    description: null,
    hsnCode: null,
    taxRate: 0,
    purchasePrice: 0,
    trackBatches: false,
    barcodeSource: null,
    ...overrides,
  };
}

// Two items: ITEM_SPLIT has stock in both real warehouses;
// ITEM_SINGLE only has stock in Main Warehouse.
const ITEM_SPLIT = makeItem({
  id: 101,
  sku: "SKU-SPLIT",
  name: "Splitter Widget",
  totalStock: 12,
  stockAtWarehouse: 10,
  warehouseStock: [
    { warehouseId: WH_MAIN.id, warehouseName: WH_MAIN.name, quantity: 10 },
    { warehouseId: WH_NORTH.id, warehouseName: WH_NORTH.name, quantity: 2 },
  ],
});
const ITEM_SINGLE = makeItem({
  id: 202,
  sku: "SKU-SINGLE",
  name: "Single Widget",
  totalStock: 5,
  stockAtWarehouse: 5,
  warehouseStock: [
    { warehouseId: WH_MAIN.id, warehouseName: WH_MAIN.name, quantity: 5 },
  ],
});

let lastFetchItemsParams: Record<string, unknown> | undefined;
let warehouses: Warehouse[] = [WH_MAIN, WH_NORTH, WH_VIRTUAL];

vi.mock(import("@/lib/queryKeys"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useGetMe: () => ({ data: { id: "user_1", name: "Test User" }, isLoading: false }),
    useGetCurrentOrganization: () => ({
      data: { id: 1, name: "Test Org", skuMode: "manual" },
      isLoading: false,
    }),
    bulkMoveWarehouse: vi.fn().mockResolvedValue(undefined),
    useListItems: () => ({ data: [ITEM_SPLIT, ITEM_SINGLE], isLoading: false }),
    useListWarehouses: () => ({ data: warehouses, isLoading: false }),
    useCreateItem: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateItem: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteItem: () => ({ mutate: vi.fn(), isPending: false }),
    getListItemsQueryKey: () => ["items"],
    getItem: vi.fn(),
    lookupItemByCode: vi.fn(),
    fetchItemsPaginated: (params?: Record<string, unknown>) => {
      if (params && Object.keys(params).length > 0) {
        lastFetchItemsParams = { ...params };
      }
      const items =
        params?.warehouseId !== undefined
          ? [ITEM_SPLIT, ITEM_SINGLE].filter((it) =>
              (it.warehouseStock ?? []).some(
                (w) => w.warehouseId === params!.warehouseId,
              ),
            )
          : [ITEM_SPLIT, ITEM_SINGLE];
      return Promise.resolve({ items, total: items.length, page: 1, pageSize: 15 });
    },
    fetchItemsFacets: () =>
      Promise.resolve({ categories: [], brands: [], units: [] }),
    fetchItemVariants: () => Promise.resolve([]),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("@/hooks/use-focus-param", () => ({
  useFocusParam: () => ({ focusId: null, clear: () => {} }),
  useNewParam: () => ({ shouldOpenNew: false, clear: () => {} }),
}));

vi.mock("@/components/BulkImportItemsDialog", () => ({
  BulkImportItemsDialog: () => null,
}));
vi.mock("@/components/BarcodeScannerDialog", () => ({
  BarcodeScannerDialog: () => null,
}));
vi.mock("@/components/ImageUploader", () => ({
  ImageUploader: () => null,
}));
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: <T,>(v: T) => v,
}));

import Items from "./Items";

function renderItems() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Router>
        <Items />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  lastFetchItemsParams = undefined;
  warehouses = [WH_MAIN, WH_NORTH, WH_VIRTUAL];
});
afterEach(() => cleanup());

describe("Items page per-warehouse stock columns", () => {
  it("shows one column header per non-virtual warehouse", async () => {
    renderItems();

    await screen.findByText("Main Warehouse");
    await screen.findByText("North Depot");

    // Virtual warehouses must not appear as column headers
    expect(screen.queryByText("Job Worker Co")).toBeNull();
  });

  it("default view shows per-warehouse stock quantities", async () => {
    renderItems();

    // Picker shows "All warehouses" by default
    const trigger = screen.getByTestId("select-items-warehouse");
    expect(trigger.textContent ?? "").toMatch(/all warehouses/i);

    // ITEM_SPLIT: Main Warehouse = 10, North Depot = 2
    const splitMain = await screen.findByTestId(
      `text-wh-stock-${ITEM_SPLIT.id}-${WH_MAIN.id}`,
    );
    expect(splitMain.textContent ?? "").toContain("10");

    const splitNorth = screen.getByTestId(
      `text-wh-stock-${ITEM_SPLIT.id}-${WH_NORTH.id}`,
    );
    expect(splitNorth.textContent ?? "").toContain("2");

    // ITEM_SINGLE: Main Warehouse = 5, North Depot = 0
    const singleMain = screen.getByTestId(
      `text-wh-stock-${ITEM_SINGLE.id}-${WH_MAIN.id}`,
    );
    expect(singleMain.textContent ?? "").toContain("5");

    const singleNorth = screen.getByTestId(
      `text-wh-stock-${ITEM_SINGLE.id}-${WH_NORTH.id}`,
    );
    expect(singleNorth.textContent ?? "").toContain("0");

    // The query was called without a warehouseId pin
    expect(lastFetchItemsParams?.warehouseId).toBeUndefined();
    expect(lastFetchItemsParams?.includeWarehouseBreakdown).toBe(true);
  });

  it("zero stock for a warehouse renders as '0 ea'", async () => {
    renderItems();

    const singleNorth = await screen.findByTestId(
      `text-wh-stock-${ITEM_SINGLE.id}-${WH_NORTH.id}`,
    );
    expect(singleNorth.textContent ?? "").toBe("0 ea");
  });

  it("switching warehouse picker filters items and the list query carries the warehouseId", async () => {
    renderItems();

    // Wait for rows to appear before interacting
    await screen.findByTestId(`text-wh-stock-${ITEM_SPLIT.id}-${WH_MAIN.id}`);

    // Open the picker and pick "North Depot"
    fireEvent.click(screen.getByTestId("select-items-warehouse"));
    const option = screen.getByRole("option", { name: "North Depot" });
    fireEvent.click(option);

    // Picker now reflects the chosen warehouse
    await waitFor(() =>
      expect(
        screen.getByTestId("select-items-warehouse").textContent ?? "",
      ).toContain("North Depot"),
    );

    // The list query was called with the picked warehouse id
    await waitFor(() =>
      expect(lastFetchItemsParams?.warehouseId).toBe(WH_NORTH.id),
    );
    expect(lastFetchItemsParams?.includeWarehouseBreakdown).toBe(true);
  });

  it("the picker hides virtual job-worker warehouses from its options", () => {
    renderItems();

    fireEvent.click(screen.getByTestId("select-items-warehouse"));
    expect(screen.getByRole("option", { name: "Main Warehouse" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "North Depot" })).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "Job Worker Co" }),
    ).toBeNull();
  });

  it("hides the warehouse picker when there is only one warehouse", async () => {
    warehouses = [WH_MAIN];
    renderItems();

    await screen.findByTestId(
      `text-wh-stock-${ITEM_SPLIT.id}-${WH_MAIN.id}`,
    );
    expect(
      screen.queryByTestId("select-items-warehouse"),
    ).toBeNull();
  });
});
