import { Bot, Copy, Link2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConnectInstructions, CreateTokenButton, PRESET_INFO } from '@/components/create-token';
import { Page } from '@/components/page';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, useLive, type TokenInfo } from '@/lib/api';
import { copy, relative } from '@/lib/format';
import { localTokens, useLocalTokens } from '@/lib/local-tokens';

/** "Full purchasing" / "Quotes only" / "Read only" from a token's scopes. */
function accessLabel(t: TokenInfo): string {
  if (t.scopes.includes('orders:write')) return PRESET_INFO.purchasing.label;
  if (t.scopes.includes('quotes:write')) return PRESET_INFO.quotes.label;
  return PRESET_INFO.readonly.label;
}

export function ConnectPage() {
  const { data: tokens, refresh } = useLive(api.tokens);
  const saved = useLocalTokens();
  const [setupFor, setSetupFor] = useState<TokenInfo>();
  const [renaming, setRenaming] = useState<TokenInfo>();
  const [revoking, setRevoking] = useState<TokenInfo>();
  const [newName, setNewName] = useState('');
  const [showRevoked, setShowRevoked] = useState(false);

  const active = tokens?.filter((t) => !t.revokedAt) ?? [];
  const revoked = tokens?.filter((t) => t.revokedAt) ?? [];

  return (
    <Page
      narrow
      title="Agents"
      description="AI assistants that can buy for you. Each gets its own link; remove one any time."
      actions={active.length > 0 && <CreateTokenButton onCreated={refresh} />}>
      {!tokens ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : active.length === 0 ? (
        <Empty className="border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>Connect your first assistant</EmptyTitle>
            <EmptyDescription>
              Create a link, paste it into Claude or ChatGPT, and your assistant can search, quote and order within your
              rules.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <CreateTokenButton
              size="lg"
              onCreated={refresh}
            />
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="py-2">
          <CardContent className="divide-y px-2">
            {active.map((t) => {
              const local = saved[t.id];
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-4 px-3 py-3">
                  <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
                    <Bot className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="text-muted-foreground text-sm">
                      {t.lastUsedAt ? `Active ${relative(t.lastUsedAt).toLowerCase()}` : 'Not used yet'}
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className="hidden font-normal sm:inline-flex">
                    {accessLabel(t)}
                  </Badge>
                  {local && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSetupFor(t)}>
                      <Link2 />
                      Connect
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`More for ${t.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!local}
                        onClick={async () => {
                          if (local && (await copy(local.connectorUrl))) toast.success('Link copied');
                        }}>
                        <Copy />
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setNewName(t.name);
                          setRenaming(t);
                        }}>
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setRevoking(t)}>
                        <Trash2 />
                        Remove access
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {revoked.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowRevoked(!showRevoked)}
            className="text-muted-foreground hover:text-foreground text-sm">
            {showRevoked ? 'Hide' : 'Show'} {revoked.length} removed
          </button>
          {showRevoked && (
            <ul className="text-muted-foreground space-y-1 text-sm">
              {revoked.map((t) => (
                <li key={t.id}>
                  <span className="line-through">{t.name}</span> · removed {relative(t.revokedAt).toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Links are saved in this browser so you can copy them again. Valio Aimo only stores a fingerprint of each one.
      </p>

      <Dialog
        open={!!setupFor}
        onOpenChange={(o) => !o && setSetupFor(undefined)}>
        {setupFor && saved[setupFor.id] && (
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Connect “{setupFor.name}”</DialogTitle>
              <DialogDescription>Paste this link into your AI assistant.</DialogDescription>
            </DialogHeader>
            <ConnectInstructions
              connectorUrl={saved[setupFor.id].connectorUrl}
              token={saved[setupFor.id].token}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>The name shows up in Activity, so pick something you’ll recognise.</DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRenaming(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!newName.trim()}
              onClick={async () => {
                await api.renameToken(renaming!.id, newName);
                toast.success('Renamed');
                setRenaming(undefined);
                refresh();
              }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove access for “{revoking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The assistant stops working with Valio Aimo right away. Orders it already placed stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={async () => {
                await api.revokeToken(revoking!.id);
                localTokens.forget(revoking!.id);
                toast.success('Access removed');
                refresh();
              }}>
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
