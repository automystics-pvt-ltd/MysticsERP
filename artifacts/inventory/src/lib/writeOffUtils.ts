export type WriteOffReason = "damage" | "lost" | "theft" | "adjustment";

export const WRITE_OFF_REASONS: {
  value: WriteOffReason;
  label: string;
  colorCls: string;
}[] = [
  { value: "damage", label: "Damaged", colorCls: "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800/40" },
  { value: "lost", label: "Lost / Misplaced", colorCls: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800/40" },
  { value: "theft", label: "Theft", colorCls: "text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-900/20 dark:border-rose-800/40" },
  { value: "adjustment", label: "General Adjustment", colorCls: "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800/40" },
];

export function reasonLabel(reason: string): string {
  return WRITE_OFF_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export function reasonColorCls(reason: string): string {
  return WRITE_OFF_REASONS.find((r) => r.value === reason)?.colorCls ?? "";
}
