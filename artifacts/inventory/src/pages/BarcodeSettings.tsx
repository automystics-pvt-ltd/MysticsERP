import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ImageUploader } from "@/components/ImageUploader";
import {
  useGetCurrentOrganization,
  useUpdateCurrentOrganization,
  getGetCurrentOrganizationQueryKey,
} from "@/lib/queryKeys";
import { ChevronRight, Printer, ScanLine, Ruler } from "lucide-react";

export default function BarcodeSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org } = useGetCurrentOrganization();
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (org) {
      setLogoUrl(org.logoUrl ?? "");
      setDirty(false);
    }
  }, [org]);

  const mutation = useUpdateCurrentOrganization({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetCurrentOrganizationQueryKey(),
        });
        toast({ title: "Label logo saved" });
        setDirty(false);
      },
      onError: () => {
        toast({
          title: "Could not save logo",
          variant: "destructive",
        });
      },
    },
  });

  const handleSave = () => {
    mutation.mutate({ data: { logoUrl: logoUrl || null } });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Barcode Label Settings"
        description="Configure how your printed 50 mm × 25 mm thermal labels look."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Label Logo
          </CardTitle>
          <CardDescription>
            Upload your brand logo to print it on every barcode label. PNG or
            JPEG, up to 2 MB. The logo appears in the top-left corner of each
            50 mm × 25 mm sticker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUploader
            value={logoUrl || null}
            onChange={(next) => {
              setLogoUrl(next ?? "");
              setDirty(true);
            }}
            testId="label-logo"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={mutation.isPending || !dirty}
              data-testid="btn-save-label-logo"
            >
              {mutation.isPending ? "Saving…" : "Save logo"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5 text-primary" />
            Label Format
          </CardTitle>
          <CardDescription>
            Current label dimensions and print settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-medium">50 mm × 25 mm</dd>
            <dt className="text-muted-foreground">Orientation</dt>
            <dd className="font-medium">Landscape</dd>
            <dt className="text-muted-foreground">Barcode format</dt>
            <dd className="font-medium">Code 128, B&amp;W</dd>
            <dt className="text-muted-foreground">Price display</dt>
            <dd className="font-medium">MRP (strikethrough) + Sale Price</dd>
            <dt className="text-muted-foreground">Compatible printers</dt>
            <dd className="font-medium">Thermal label printers (e.g. Zebra, Honeywell, Xprinter)</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            Barcode Prefix
          </CardTitle>
          <CardDescription>
            Manage the auto-barcode prefix and format in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings">
            <a
              className="flex items-center justify-between rounded-md border p-3 hover-elevate active-elevate-2"
              data-testid="link-barcode-settings"
            >
              <div>
                <div className="text-sm font-medium">Barcode prefix &amp; format</div>
                <div className="text-xs text-muted-foreground">
                  Set the prefix for auto-generated barcodes.
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </a>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
