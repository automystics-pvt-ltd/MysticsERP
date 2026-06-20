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
 * Renders nothing while permissions are loading to avoid flashing restricted UI.
 */
export function Can({ module, action, children, fallback = null }: CanProps) {
  const { data, isLoading } = useMyPermissions();

  if (isLoading || !data) return null;
  if (data.isSuperAdmin) return <>{children}</>;

  const allowed = data.permissions[module]?.includes(action) ?? false;
  return allowed ? <>{children}</> : <>{fallback}</>;
}
