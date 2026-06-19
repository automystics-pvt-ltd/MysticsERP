import { useEffect, useState, type FormEvent } from "react";
import {
  Palette, Globe, Bell, Shield,
  ChevronRight, Mail, MessageCircle, Smartphone,
  CheckCircle2, Plug, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  useGetEmailSettings,
  useUpsertEmailSettings,
  useDeleteEmailSettings,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const SIDEBAR_NAV = [
  { icon: Palette,   label: "Appearance",   href: "/settings/appearance" },
  { icon: Globe,     label: "Localization",  href: null },
  { icon: Bell,      label: "Notifications", href: "/settings/notifications" },
  { icon: Shield,    label: "Security",      href: null },
];

type Secure = "ssl" | "starttls" | "none";

function ChannelRow({
  icon: Icon,
  color,
  label,
  description,
  connected,
  children,
}: {
  icon: React.ElementType;
  color: string;
  label: string;
  description: string;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-6">
      {/* Vertical line + icon */}
      <div className="flex flex-col items-center flex-shrink-0 w-10">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
          style={{ backgroundColor: `${color}18`, border: `1px solid ${color}30` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <div className="flex-1 w-px bg-border mt-3" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-10">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-foreground">{label}</span>
          {connected ? (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1 font-medium text-green-700 bg-green-100 border-green-200">
              <CheckCircle2 className="w-2.5 h-2.5" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-medium text-muted-foreground">
              Not configured
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">{description}</p>
        {children}
      </div>
    </div>
  );
}

function EmailSection() {
  const settingsQuery = useGetEmailSettings();
  const upsert = useUpsertEmailSettings();
  const del = useDeleteEmailSettings();
  const { toast } = useToast();

  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(587);
  const [secure, setSecure] = useState<Secure>("starttls");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setHost(s.host);
    setPort(s.port);
    setSecure(s.secure as Secure);
    setUsername(s.username);
    setFromEmail(s.fromEmail);
    setFromName(s.fromName ?? "");
  }, [settingsQuery.data]);

  const isConnected = !!settingsQuery.data?.host;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await upsert.mutateAsync({
        data: { host, port, secure, username, ...(password ? { password } : {}), fromEmail, fromName: fromName || undefined },
      });
      toast({ title: "Email settings saved" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDisconnect() {
    await del.mutateAsync();
    setHost(""); setPort(587); setSecure("starttls");
    setUsername(""); setPassword(""); setFromEmail(""); setFromName("");
    toast({ title: "Email settings removed" });
  }

  return (
    <ChannelRow
      icon={Mail}
      color="#6366f1"
      label="Email"
      description="Send invoice emails, payment reminders and order confirmations via your own SMTP server."
      connected={isConnected}
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">SMTP Host</Label>
            <Input className="mt-1 h-8 text-sm" value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.gmail.com" required />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input className="mt-1 h-8 text-sm" type="number" value={port} onChange={e => setPort(Number(e.target.value))} required />
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Security</Label>
          <Select value={secure} onValueChange={v => setSecure(v as Secure)}>
            <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ssl">SSL/TLS (port 465)</SelectItem>
              <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
              <SelectItem value="none">None (port 25)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input className="mt-1 h-8 text-sm" value={username} onChange={e => setUsername(e.target.value)} placeholder="you@company.com" required />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input className="mt-1 h-8 text-sm" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={isConnected ? "••••••• (unchanged)" : ""} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">From email</Label>
            <Input className="mt-1 h-8 text-sm" type="email" value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="invoices@company.com" required />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">From name</Label>
            <Input className="mt-1 h-8 text-sm" value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Mystics Inventory" />
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={upsert.isPending}>
            {upsert.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            {isConnected ? "Update" : "Connect"}
          </Button>
          {isConnected && (
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs text-destructive border-destructive/40 hover:bg-destructive/5" onClick={handleDisconnect} disabled={del.isPending}>
              Disconnect
            </Button>
          )}
        </div>
      </form>
    </ChannelRow>
  );
}

function ComingSoonSection({
  icon,
  color,
  label,
  description,
  fields,
}: {
  icon: React.ElementType;
  color: string;
  label: string;
  description: string;
  fields: { label: string; placeholder: string; type?: string }[];
}) {
  const { toast } = useToast();
  return (
    <ChannelRow icon={icon} color={color} label={label} description={description} connected={false}>
      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f.label}>
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            <Input
              className="mt-1 h-8 text-sm"
              type={f.type ?? "text"}
              placeholder={f.placeholder}
              disabled
            />
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled
            onClick={() => toast({ title: `${label} integration coming soon` })}
          >
            <Plug className="w-3.5 h-3.5" /> Connect {label}
          </Button>
          <span className="text-[11px] text-muted-foreground italic">Integration coming soon</span>
        </div>
      </div>
    </ChannelRow>
  );
}

export default function NotificationSettings() {
  const [location] = useLocation();

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 overflow-hidden">

      {/* Settings sub-sidebar */}
      <aside className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col">
        <div className="px-4 h-12 flex items-center border-b border-border">
          <span className="text-sm font-semibold text-foreground">Settings</span>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {SIDEBAR_NAV.map(({ icon: Icon, label, href }) => {
            const isActive = href !== null && location.startsWith(href);
            const inner = (
              <div
                className={cn(
                  "flex items-center justify-between py-2 rounded-r-lg text-sm transition-colors cursor-pointer select-none",
                  isActive
                    ? "border-l-2 border-primary text-primary font-medium pl-[10px] pr-3 bg-primary/5"
                    : href
                    ? "border-l-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-accent pl-[10px] pr-3"
                    : "border-l-2 border-transparent text-muted-foreground/40 cursor-default pl-[10px] pr-3",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                </div>
                {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-40" />}
              </div>
            );
            return href ? (
              <Link key={label} href={href}>{inner}</Link>
            ) : (
              <div key={label}>{inner}</div>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-2xl px-10 py-8">

          <div className="mb-8">
            <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure how Mystics sends messages to your customers and team
            </p>
          </div>

          {/* Channel list — vertical timeline style */}
          <div>
            <EmailSection />

            <ComingSoonSection
              icon={MessageCircle}
              color="#25D366"
              label="WhatsApp"
              description="Send order confirmations, shipment updates and payment reminders via WhatsApp Business API."
              fields={[
                { label: "WhatsApp Business Phone Number ID", placeholder: "e.g. 1234567890" },
                { label: "Access Token", placeholder: "EAAxxxxxxxxxxxxxxx", type: "password" },
                { label: "From phone number", placeholder: "+91 98765 43210" },
              ]}
            />

            <ComingSoonSection
              icon={Smartphone}
              color="#0ea5e9"
              label="SMS"
              description="Send SMS alerts for low stock, order dispatch and payment confirmations via Twilio or MSG91."
              fields={[
                { label: "Provider", placeholder: "Twilio / MSG91" },
                { label: "API Key / Account SID", placeholder: "ACxxxxxxxxxxxxxxx" },
                { label: "Sender ID / From number", placeholder: "+91 98765 43210" },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
