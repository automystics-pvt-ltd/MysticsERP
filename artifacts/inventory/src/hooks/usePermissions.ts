import { useQuery } from "@tanstack/react-query";
import { useGetCurrentOrganization } from "@/lib/queryKeys";

export interface ModuleGroup {
  label: string;
  modules: string[];
}

export interface PermissionsResponse {
  role: string;
  isSuperAdmin: boolean;
  permissions: Record<string, string[]>;
  modules: Record<string, string>;
  actions: Record<string, string>;
  moduleGroups: ModuleGroup[];
  moduleActions: Record<string, string[]>;
}

export function useMyPermissions() {
  const { data: org } = useGetCurrentOrganization();
  const orgId = (org as { id?: number } | undefined)?.id;

  return useQuery<PermissionsResponse>({
    queryKey: ["permissions", "me", orgId],
    queryFn: async () => {
      const res = await fetch("/api/permissions/me", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load permissions");
      return res.json() as Promise<PermissionsResponse>;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Returns true if the current user can perform `action` on `module`.
 * Returns false while permissions are loading so restricted UI stays hidden.
 */
export function useCanI(module: string, action: string): boolean {
  const { data, isLoading } = useMyPermissions();
  if (isLoading || !data) return false;
  if (data.isSuperAdmin) return true;
  return data.permissions[module]?.includes(action) ?? false;
}

/**
 * Returns the full set of actions the current user can do on a module.
 */
export function useModuleActions(module: string): string[] {
  const { data } = useMyPermissions();
  if (!data) return [];
  if (data.isSuperAdmin) return Object.keys(data.actions);
  return data.permissions[module] ?? [];
}
