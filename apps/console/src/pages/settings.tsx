import { ExternalLink, Fingerprint, RotateCcw, Server, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { CopyField } from '@/components/copy-field';
import { Page } from '@/components/page';
import { Pill } from '@/components/status';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type Info } from '@/lib/api';

export function SettingsPage({ info, refreshShell }: { info?: Info; refreshShell: () => void }) {
  if (!info) {
    return (
      <Page title="Settings">
        <Skeleton className="h-64 rounded-xl" />
      </Page>
    );
  }
  return (
    <Page
      title="Settings"
      narrow
      description="Technical details and demo controls.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4" />
              Gateway
            </CardTitle>
            <CardDescription>MCP over Streamable HTTP, with MCP Apps widgets.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">MCP endpoint (append /&lt;token&gt;, or send a Bearer header)</Label>
              <CopyField
                label="Endpoint"
                value={info.mcpUrl}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Access without a token</span>
              <Pill tone={info.anonymousAllowed ? 'warning' : 'success'}>
                {info.anonymousAllowed ? 'Allowed' : 'Blocked'}
              </Pill>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="size-4" />
              Quote signing key
            </CardTitle>
            <CardDescription>
              Every quote is signed with Ed25519, so agents can verify price and availability claims without trusting
              the transport.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">Key ID</Label>
              <CopyField
                label="Key ID"
                value={info.signingKeyId}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              asChild>
              <a
                href={info.jwksUrl}
                target="_blank"
                rel="noreferrer">
                <ExternalLink />
                Public key (JWKS)
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-destructive/30 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="text-destructive size-4" />
              Reset demo
            </CardTitle>
            <CardDescription>
              Clears orders, quotes and the audit log, restores the default rules and refills kitchen stock. Tokens and
              your sourcing promise are kept, so connected assistants stay connected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <RotateCcw />
                  Reset demo data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All orders, quotes and audit events are deleted and the mandate goes back to €1,500 per order and
                    €6,000 per week.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive/90 text-white"
                    onClick={async () => {
                      await api.reset();
                      refreshShell();
                      toast.success('Demo reset');
                    }}>
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
