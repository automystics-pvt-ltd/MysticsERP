import { useState, useMemo } from "react";
import {
  useListTeamMembers,
  useCreateTeamUser,
  useUpdateTeamMemberRole,
  useRemoveTeamMember,
  getListTeamMembersQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { ROLE_VALUES, ROLE_LABELS, normalizeRole, type Role } from "@/lib/permissions";
import { useGetMe } from "@/lib/queryKeys";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  MoreHorizontal,
  KeyRound,
  UserX,
  UserCheck,
  Receipt,
  Boxes,
  Users,
  ShieldCheck,
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RolePermissionsPanel } from "@/pages/RolePermissions";

type TeamMember = {
  id: number;
  userId: number;
  email: string;
  name: string | null;
  role: string;
  canEditBills: boolean;
  canEditStocks: boolean;
  isActive: boolean;
  createdAt: string;
};

const ROLE_OPTIONS = ROLE_VALUES;
const PAGE_SIZE = 10;

type ActiveTab = "users" | "roles";

export default function Team() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const membersQuery = useListTeamMembers();
  const members = (membersQuery.data ?? []) as TeamMember[];
  const meQuery = useGetMe();
  const me = meQuery.data;
  const myRole = me?.role ?? null;
  const myRoleNormalized = normalizeRole(myRole);
  const canManage = myRoleNormalized === "owner" || myRoleNormalized === "admin";
  const isOwner = myRoleNormalized === "owner";

  const [activeTab, setActiveTab] = useState<ActiveTab>("users");

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<Role>("viewer");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const [resetPwd, setResetPwd] = useState<{
    open: boolean;
    memberId: number | null;
    memberEmail: string;
    value: string;
  }>({ open: false, memberId: null, memberEmail: "", value: "" });

  const invalidateAll = async () => {
    await qc.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
  };

  const createUser = useCreateTeamUser({
    mutation: {
      onSuccess: async () => {
        setNewUserUsername("");
        setNewUserEmail("");
        setNewUserName("");
        setNewUserPassword("");
        setNewUserRole("viewer");
        setAddUserOpen(false);
        await invalidateAll();
        toast({
          title: "User created",
          description: "They can sign in immediately with the password you set.",
        });
      },
      onError: (err: unknown) =>
        toast({
          title: "Could not create user",
          description: err instanceof Error ? err.message : "Try again",
          variant: "destructive",
        }),
    },
  });

  const updateRole = useUpdateTeamMemberRole({
    mutation: {
      onSuccess: async () => {
        await invalidateAll();
        toast({ title: "Role updated" });
      },
      onError: async (err: unknown) => {
        await invalidateAll();
        toast({
          title: "Could not update role",
          description: err instanceof Error ? err.message : "Try again",
          variant: "destructive",
        });
      },
    },
  });

  const removeMember = useRemoveTeamMember({
    mutation: {
      onSuccess: async () => {
        await invalidateAll();
        toast({ title: "Member removed" });
      },
      onError: (err: unknown) =>
        toast({
          title: "Could not remove",
          description: err instanceof Error ? err.message : "Try again",
          variant: "destructive",
        }),
    },
  });

  const updatePermissions = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: number;
      patch: { canEditBills?: boolean; canEditStocks?: boolean; isActive?: boolean };
    }) => {
      await customFetch(`/api/team/members/${id}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    onSuccess: async (_, { patch }) => {
      await invalidateAll();
      if (patch.isActive !== undefined) {
        toast({ title: patch.isActive ? "Member activated" : "Member suspended" });
      } else {
        toast({ title: "Permissions updated" });
      }
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not update permissions",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      }),
  });

  const resetPassword = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      await customFetch(`/api/team/members/${id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
    },
    onSuccess: async () => {
      setResetPwd({ open: false, memberId: null, memberEmail: "", value: "" });
      toast({ title: "Password reset", description: "The new password is active immediately." });
    },
    onError: (err: unknown) =>
      toast({
        title: "Could not reset password",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      }),
  });

  function submitCreateUser(e: React.FormEvent) {
    e.preventDefault();
    const cleanUsername = newUserUsername.trim();
    const cleanEmail = newUserEmail.trim();
    const cleanName = newUserName.trim();
    if (!cleanUsername || !cleanEmail || !cleanName) return;
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(cleanUsername)) {
      toast({
        title: "Invalid username",
        description: "3–30 characters, letters/numbers/underscore only.",
        variant: "destructive",
      });
      return;
    }
    if (newUserPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    createUser.mutate({
      data: {
        username: cleanUsername,
        email: cleanEmail,
        name: cleanName,
        password: newUserPassword,
        role: newUserRole,
      },
    });
  }

  const ownerCount = members.filter((m) => m.role === "owner").length;

  const assignableRoles: ReadonlyArray<Role> = isOwner
    ? ROLE_OPTIONS
    : (ROLE_OPTIONS.filter((r) => r !== "owner") as Role[]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (q && !m.email.toLowerCase().includes(q) && !(m.name ?? "").toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (statusFilter === "active" && m.isActive === false) return false;
      if (statusFilter === "suspended" && m.isActive !== false) return false;
      return true;
    });
  }, [members, search, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const pageMembers = filteredMembers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const tabs: { id: ActiveTab; label: string; icon: React.ElementType }[] = [
    { id: "users", label: "Users", icon: Users },
    { id: "roles", label: "Roles & Permissions", icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6" data-testid="page-team">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users & Roles</h1>
          <p className="text-sm text-muted-foreground">
            Manage team members, access control, and role permissions from one place.
          </p>
        </div>
        {me && (
          <div
            className="text-sm text-muted-foreground rounded-md border border-border/60 px-3 py-2 bg-muted/30"
            data-testid="text-signed-in-as"
          >
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {me.user.name ?? me.user.email}
            </span>
            <span className="ml-2">
              <Badge variant="outline" data-testid="badge-my-role">
                {myRole ?? "unknown"}
              </Badge>
            </span>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Users tab */}
      {activeTab === "users" && (
        <>
          {meQuery.isSuccess && !canManage && (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                You're signed in as <span className="font-medium">{myRole}</span>.
                Only owners and admins can manage team members or change roles. Ask
                an owner to upgrade your role if you need to manage the team.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle>Members</CardTitle>
                {canManage && (
                  <Button
                    size="sm"
                    onClick={() => setAddUserOpen(true)}
                    data-testid="button-open-add-user"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add User
                  </Button>
                )}
              </div>

              {/* Search & filter bar */}
              <div className="flex flex-wrap gap-2 pt-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search by name or email…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-8 text-sm"
                    data-testid="input-search-members"
                  />
                </div>
                <Select
                  value={roleFilter}
                  onValueChange={(v) => { setRoleFilter(v); setPage(1); }}
                >
                  <SelectTrigger className="h-8 w-[130px] text-sm" data-testid="select-filter-role">
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
                >
                  <SelectTrigger className="h-8 w-[130px] text-sm" data-testid="select-filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageMembers.map((m) => {
                    const isMe = me?.user.id === m.userId;
                    const editable =
                      canManage &&
                      !(m.role === "owner" && !isOwner) &&
                      !(m.role === "owner" && ownerCount <= 1);
                    const optionsForRow: ReadonlyArray<Role> = isOwner
                      ? ROLE_OPTIONS
                      : (ROLE_OPTIONS.filter((r) => r !== "owner") as Role[]);
                    const rowOptions: ReadonlyArray<string> = optionsForRow.includes(m.role as Role)
                      ? optionsForRow
                      : [...optionsForRow, m.role];
                    const canRemove =
                      canManage &&
                      !isMe &&
                      !(m.role === "owner" && !isOwner) &&
                      !(m.role === "owner" && ownerCount <= 1);
                    const canToggleActive =
                      canManage &&
                      !isMe &&
                      (isOwner || m.role !== "owner");

                    return (
                      <TableRow
                        key={m.id}
                        data-testid={`row-member-${m.id}`}
                        className={m.isActive === false ? "opacity-60" : undefined}
                      >
                        <TableCell>
                          {m.email}
                          {isMe && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              you
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{m.name ?? "—"}</TableCell>
                        <TableCell>
                          <Select
                            value={m.role}
                            disabled={!editable}
                            onValueChange={(v) =>
                              updateRole.mutate({ id: m.id, data: { role: v } })
                            }
                          >
                            <SelectTrigger className="w-32" data-testid={`select-role-${m.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {rowOptions.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {ROLE_LABELS[r as Role] ?? r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {m.canEditBills && (
                              <Badge variant="secondary" className="text-[10px] gap-1">
                                <Receipt className="h-2.5 w-2.5" />Bills
                              </Badge>
                            )}
                            {m.canEditStocks && (
                              <Badge variant="secondary" className="text-[10px] gap-1">
                                <Boxes className="h-2.5 w-2.5" />Stocks
                              </Badge>
                            )}
                            {!m.canEditBills && !m.canEditStocks && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {m.isActive !== false ? (
                            <Badge
                              variant="outline"
                              className="text-xs text-green-700 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-800 dark:bg-green-950/30"
                            >
                              Active
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs text-red-700 border-red-200 bg-red-50 dark:text-red-400 dark:border-red-800 dark:bg-red-950/30"
                            >
                              Suspended
                            </Badge>
                          )}
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  data-testid={`btn-actions-${m.id}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                {!isMe && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setResetPwd({
                                        open: true,
                                        memberId: m.id,
                                        memberEmail: m.email,
                                        value: "",
                                      })
                                    }
                                    data-testid={`btn-reset-pwd-${m.id}`}
                                  >
                                    <KeyRound className="h-4 w-4 mr-2" />
                                    Reset password
                                  </DropdownMenuItem>
                                )}
                                {!isMe && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      updatePermissions.mutate({
                                        id: m.id,
                                        patch: { canEditBills: !m.canEditBills },
                                      })
                                    }
                                  >
                                    <Receipt className="h-4 w-4 mr-2" />
                                    {m.canEditBills ? "Revoke bills edit" : "Allow bills edit"}
                                  </DropdownMenuItem>
                                )}
                                {!isMe && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      updatePermissions.mutate({
                                        id: m.id,
                                        patch: { canEditStocks: !m.canEditStocks },
                                      })
                                    }
                                  >
                                    <Boxes className="h-4 w-4 mr-2" />
                                    {m.canEditStocks ? "Revoke stocks edit" : "Allow stocks edit"}
                                  </DropdownMenuItem>
                                )}
                                {canToggleActive && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() =>
                                        updatePermissions.mutate({
                                          id: m.id,
                                          patch: { isActive: !m.isActive },
                                        })
                                      }
                                      data-testid={`btn-toggle-active-${m.id}`}
                                      className={
                                        m.isActive !== false
                                          ? "text-amber-600 focus:text-amber-600"
                                          : undefined
                                      }
                                    >
                                      {m.isActive !== false ? (
                                        <>
                                          <UserX className="h-4 w-4 mr-2" />
                                          Suspend access
                                        </>
                                      ) : (
                                        <>
                                          <UserCheck className="h-4 w-4 mr-2" />
                                          Restore access
                                        </>
                                      )}
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {canRemove && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => {
                                        if (confirm(`Remove ${m.email} from the organization?`)) {
                                          removeMember.mutate({ id: m.id });
                                        }
                                      }}
                                      data-testid={`button-remove-${m.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove from org
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {pageMembers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground py-8">
                        {filteredMembers.length === 0 && members.length > 0
                          ? "No members match your filters"
                          : "No members yet"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t pt-4 mt-2">
                  <p className="text-sm text-muted-foreground">
                    {filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}
                    {" · "}Page {page} of {totalPages}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                      data-testid="btn-page-prev"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={page === totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      data-testid="btn-page-next"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add User dialog */}
          <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create a user</DialogTitle>
                <DialogDescription>
                  Create the account directly with a password — they can sign in
                  immediately. Use this when you want to skip the email invitation step.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={submitCreateUser}
                className="space-y-4"
                data-testid="form-create-user"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="new-user-username">
                      Username <span className="text-muted-foreground font-normal text-xs">(for login)</span>
                    </Label>
                    <Input
                      id="new-user-username"
                      type="text"
                      value={newUserUsername}
                      onChange={(e) => setNewUserUsername(e.target.value)}
                      placeholder="anita_sharma"
                      pattern="[a-zA-Z0-9_]{3,30}"
                      title="3–30 characters, letters/numbers/underscore only"
                      data-testid="input-new-user-username"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-user-name">Full name</Label>
                    <Input
                      id="new-user-name"
                      type="text"
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      placeholder="Anita Sharma"
                      data-testid="input-new-user-name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-user-email">Email</Label>
                    <Input
                      id="new-user-email"
                      type="email"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="anita@example.com"
                      data-testid="input-new-user-email"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-user-password">Password</Label>
                    <Input
                      id="new-user-password"
                      type="password"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      minLength={8}
                      data-testid="input-new-user-password"
                      required
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="new-user-role">Role</Label>
                    <Select
                      value={assignableRoles.includes(newUserRole) ? newUserRole : "viewer"}
                      onValueChange={(v) => setNewUserRole(v as Role)}
                    >
                      <SelectTrigger id="new-user-role" data-testid="select-new-user-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableRoles.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddUserOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createUser.isPending} data-testid="button-create-user">
                    {createUser.isPending ? "Creating..." : "Create user"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Reset password dialog */}
          <Dialog
            open={resetPwd.open}
            onOpenChange={(open) =>
              setResetPwd((s) => ({ ...s, open, value: open ? s.value : "" }))
            }
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset password</DialogTitle>
                <DialogDescription>
                  Set a new password for <strong>{resetPwd.memberEmail}</strong>. They'll
                  need to use this the next time they sign in.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="reset-pwd-input">New password</Label>
                <Input
                  id="reset-pwd-input"
                  type="password"
                  value={resetPwd.value}
                  onChange={(e) => setResetPwd((s) => ({ ...s, value: e.target.value }))}
                  placeholder="At least 8 characters"
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setResetPwd({ open: false, memberId: null, memberEmail: "", value: "" })}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (resetPwd.memberId !== null) {
                      resetPassword.mutate({ id: resetPwd.memberId, password: resetPwd.value });
                    }
                  }}
                  disabled={resetPwd.value.length < 8 || resetPassword.isPending}
                >
                  {resetPassword.isPending ? "Resetting…" : "Reset password"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Roles & Permissions tab */}
      {activeTab === "roles" && <RolePermissionsPanel />}
    </div>
  );
}
