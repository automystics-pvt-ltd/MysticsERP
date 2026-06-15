import { useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { customFetch, ApiError } from "@workspace/api-client-react";
import type { AuthSession } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/AuthShell";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const inputCls =
  "w-full bg-[#f9f8fe] dark:bg-input border border-[#ddd8f7] dark:border-border text-foreground rounded-lg text-[14px] px-3 py-2.5 placeholder:text-[#9ca3af] dark:placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(263_70%_55%)] focus:ring-2 focus:ring-[hsl(263_70%_50%/0.15)] transition-all";

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const sessionExpired = new URLSearchParams(search).get("reason") === "session_expired";
  const { refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await customFetch<AuthSession>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await refresh();
      setLocation("/dashboard");
    } catch (err) {
      const apiErr = err as ApiError;
      const data = apiErr?.data as { error?: string; code?: string } | undefined;
      setError(data?.error ?? "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={onSubmit} className="w-full space-y-2" noValidate>
        {sessionExpired && !error && (
          <Alert data-testid="signin-session-expired" className="mb-3 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertDescription>Your session expired — please sign in again.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" data-testid="signin-error" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <input
          id="signin-username"
          type="text"
          autoComplete="username"
          required
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          data-testid="input-signin-email"
          className={inputCls}
        />

        <input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="input-signin-password"
          className={inputCls}
        />

        <button
          type="submit"
          disabled={submitting || !username || !password}
          data-testid="btn-signin-submit"
          className="w-full mt-2 bg-[hsl(263_70%_50%)] hover:bg-[hsl(263_70%_42%)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-[14px] rounded-lg py-2.5 transition-colors shadow-sm"
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>

        <div className="flex items-center gap-3 my-3">
          <div className="flex-1 h-px bg-[#e5e7eb] dark:bg-border" />
          <span className="text-[13px] font-semibold text-[#9ca3af] dark:text-muted-foreground tracking-wide">OR</span>
          <div className="flex-1 h-px bg-[#e5e7eb] dark:bg-border" />
        </div>

        <div className="text-center">
          <Link
            href="/forgot-password"
            className="text-[12px] text-[hsl(263_70%_50%)] hover:text-[hsl(263_70%_35%)]"
            data-testid="link-forgot-password"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

void basePath;
