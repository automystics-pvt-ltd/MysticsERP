import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export type ItemForPicker = {
  id: number;
  sku: string;
  name: string;
  hasVariants?: boolean;
  parentItemId?: number | null;
  variantOptions?: Record<string, unknown> | null;
  salePrice?: number;
  purchasePrice?: number;
  taxRate?: number;
  description?: string | null;
  stockAtWarehouse?: number | null;
};

type Props = {
  items: ItemForPicker[];
  selectedItemId: number | null;
  parentSelection: number | null;
  onParentChange: (parentId: number | null) => void;
  onVariantChange: (itemId: number) => void;
  testIdPrefix: string;
  disabled?: boolean;
  errorMessage?: string;
  showStockHint?: boolean;
  /** Placeholder shown when the picker is disabled (e.g. waiting for a
   *  warehouse to be picked first). Overrides the default "Select item". */
  disabledMessage?: string;
  /** Placeholder shown when the picker is enabled but no items are available
   *  (e.g. no items in stock at the chosen warehouse). */
  emptyMessage?: string;
};

function variantLabel(opts: Record<string, unknown> | null | undefined): string {
  if (!opts) return "";
  const parts = Object.entries(opts)
    .filter(([k]) => k !== "axes")
    .map(([, v]) => (typeof v === "string" ? v : ""))
    .filter(Boolean);
  return parts.join(" / ");
}

export function ItemPicker({
  items,
  selectedItemId,
  parentSelection,
  onParentChange,
  onVariantChange,
  testIdPrefix,
  disabled,
  errorMessage,
  showStockHint,
  disabledMessage,
  emptyMessage,
}: Props) {
  const [open, setOpen] = useState(false);

  const { topLevel, childrenByParent } = useMemo(() => {
    const top: ItemForPicker[] = [];
    const byParent = new Map<number, ItemForPicker[]>();
    for (const i of items) {
      if (i.parentItemId == null) {
        top.push(i);
      } else {
        const arr = byParent.get(i.parentItemId) ?? [];
        arr.push(i);
        byParent.set(i.parentItemId, arr);
      }
    }
    return { topLevel: top, childrenByParent: byParent };
  }, [items]);

  const effectiveParentId = (() => {
    if (parentSelection != null) return parentSelection;
    if (selectedItemId == null) return null;
    const cur = items.find((i) => i.id === selectedItemId);
    if (!cur) return null;
    return cur.parentItemId ?? cur.id;
  })();

  const parentItem =
    effectiveParentId != null
      ? items.find((i) => i.id === effectiveParentId) ?? null
      : null;
  const variants =
    parentItem && parentItem.hasVariants
      ? childrenByParent.get(parentItem.id) ?? []
      : [];

  const triggerLabel = (() => {
    if (disabled && disabledMessage) return disabledMessage;
    if (!disabled && topLevel.length === 0 && emptyMessage) return emptyMessage;
    if (!parentItem) return "Select item";
    const stockSuffix =
      showStockHint && !parentItem.hasVariants && parentItem.stockAtWarehouse != null
        ? ` (stock: ${parentItem.stockAtWarehouse})`
        : "";
    return `${parentItem.sku} - ${parentItem.name}${parentItem.hasVariants ? " (has variants)" : stockSuffix}`;
  })();

  return (
    <div className="space-y-2">
      <FormItem>
        <FormLabel className="text-xs">Item</FormLabel>
        <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              data-testid={`${testIdPrefix}-parent`}
              className={cn(
                "w-full justify-between font-normal h-10 px-3",
                !parentItem && "text-muted-foreground",
              )}
            >
              <span className="truncate text-left">{triggerLabel}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0"
            style={{ width: "var(--radix-popover-trigger-width)" }}
            align="start"
          >
            <Command
              filter={(value, search) => {
                if (!search) return 1;
                const lower = search.toLowerCase();
                return value.toLowerCase().includes(lower) ? 1 : 0;
              }}
            >
              <CommandInput placeholder="Search by name or SKU…" />
              <CommandList>
                <CommandEmpty>No items found.</CommandEmpty>
                <CommandGroup>
                  {topLevel.map((i) => {
                    const stockSuffix =
                      showStockHint && !i.hasVariants && i.stockAtWarehouse != null
                        ? ` (stock: ${i.stockAtWarehouse})`
                        : "";
                    const label = `${i.sku} - ${i.name}${i.hasVariants ? " (has variants)" : stockSuffix}`;
                    return (
                      <CommandItem
                        key={i.id}
                        value={label}
                        onSelect={() => {
                          onParentChange(i.id);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            effectiveParentId === i.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {!parentItem?.hasVariants && errorMessage ? (
          <FormMessage>{errorMessage}</FormMessage>
        ) : null}
      </FormItem>

      {parentItem?.hasVariants ? (
        <FormItem>
          <FormLabel className="text-xs">Variant</FormLabel>
          <Select
            disabled={disabled || variants.length === 0}
            onValueChange={(val) => {
              const vid = parseInt(val, 10);
              onVariantChange(vid);
            }}
            value={selectedItemId ? selectedItemId.toString() : ""}
          >
            <SelectTrigger data-testid={`${testIdPrefix}-variant`}>
              <SelectValue
                placeholder={
                  variants.length === 0
                    ? "No variants yet — add some on the item page"
                    : "Select variant"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {variants.map((v) => {
                const lbl = variantLabel(v.variantOptions);
                const base = lbl ? `${lbl} — ${v.sku}` : v.sku;
                const stockSuffix =
                  showStockHint && v.stockAtWarehouse != null
                    ? ` (stock: ${v.stockAtWarehouse})`
                    : "";
                return (
                  <SelectItem key={v.id} value={v.id.toString()}>
                    {base}
                    {stockSuffix}
                  </SelectItem>
                );
              })}
            </SelectContent>
            {errorMessage ? <FormMessage>{errorMessage}</FormMessage> : null}
          </Select>
        </FormItem>
      ) : null}
    </div>
  );
}
