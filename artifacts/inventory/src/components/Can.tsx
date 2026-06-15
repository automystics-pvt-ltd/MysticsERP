import type { ReactNode } from "react";
import { useMyPermissions } from "@/hooks/usePermissions";

interface CanProps {
  module: string;
  action: string;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Renders `children` when the current user has `module.action` permission.
 * Renders `fallback` (default: null) otherwise.
 * Shows children while permissions are loading (optimistic — server enforces).
 */
export function Can({ module, action, children, fallback = null }: CanProps) {
  const { data, isLoading } = useMyPermissions();

  if (isLoading || !data) return <>{children}</>;
  if (data.isSuperAdmin) return <>{children}</>;

  const allowed = data.permissions[module]?.includes(action) ?? false;
  return allowed ? <>{children}</> : <>{fallback}</>;
}
