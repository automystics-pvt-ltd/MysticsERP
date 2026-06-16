import { lazy, Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

const RolePermissionsPanel = lazy(() =>
  import("@/pages/RolePermissions").then((m) => ({ default: m.RolePermissionsPanel })),
);

export default function RolePermissionsPage() {
  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Configure what each role can see and do across all modules. Changes take effect immediately."
      />
      <Suspense fallback={<div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}>
        <RolePermissionsPanel />
      </Suspense>
    </>
  );
}
