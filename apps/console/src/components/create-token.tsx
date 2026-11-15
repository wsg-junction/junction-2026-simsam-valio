import { ChevronDown, KeyRound, Laptop, Loader2, MessageSquare, ShieldAlert, Sparkles, Terminal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CopyField } from '@/components/copy-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type CreatedToken } from '@/lib/api';
import { localTokens } from '@/lib/local-tokens';

export const PRESET_INFO: Record<string, { label: string; description: string }> = {
  purchasing: { label: 'Full purchasing', description: 'Search, quote and order. Orders outside the mandate go to approval.' },
  quotes: { label: 'Quotes only', description: 'Search and request signed quotes, but never place orders.' },
  readonly: { label: 'Read only', description: 'Browse the assortment and check order status.' },
};

/** "Create token" in one click, with a dropdown for name and permissions. */
export function CreateTokenButton({ size = 'default', onCreated }: { size?: 'default' | 'lg'; onCreated?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedToken>();
  const [customizing, setCustomizing] = useState(false);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState('purchasing');

  const create = async (input: { name?: string; preset?: string }) => {
    setBusy(true);
    try {
      const result = await api.createToken(input);
      localTokens.save(result.info.id, { token: result.token, connectorUrl: result.connectorUrl });
      setCreated(result);
      setCustomizing(false);
      setName('');
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex">
        <Button
          size={size}
          className="rounded-r-none"
          disabled={busy}
          onClick={() => create({ preset: 'purchasing' })}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Connect an assistant
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size={size}
              className="border-primary-foreground/20 rounded-l-none border-l px-2"
              aria-label="More token options"
              disabled={busy}>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-64">
            <DropdownMenuLabel>What may it do?</DropdownMenuLabel>
            {Object.entries(PRESET_INFO).map(([key, p]) => (
              <DropdownMenuItem
                key={key}
                onClick={() => create({ preset: key })}
                className="flex-col items-start gap-0.5">
                <span className="font-medium">{p.label}</span>
                <span className="text-muted-foreground text-xs">{p.description}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCustomizing(true)}>Choose a name…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={customizing}
        onOpenChange={setCustomizing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect an assistant</DialogTitle>
            <DialogDescription>The name shows up in Activity, so you can tell your assistants apart.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                placeholder="e.g. Claude · Maria's laptop"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>What may it do?</Label>
              <RadioGroup
                value={preset}
                onValueChange={setPreset}>
                {Object.entries(PRESET_INFO).map(([key, p]) => (
                  <Label
                    key={key}
                    htmlFor={`preset-${key}`}
                    className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal">
                    <RadioGroupItem
                      id={`preset-${key}`}
                      value={key}
                      className="mt-0.5"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted-foreground text-xs">{p.description}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCustomizing(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => create({ name: name || undefined, preset })}>
              <KeyRound />
              Create link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TokenReadyDialog
        created={created}
        onClose={() => setCreated(undefined)}
      />
    </>
  );
}

export function TokenReadyDialog({ created, onClose }: { created?: CreatedToken; onClose: () => void }) {
  return (
    <Dialog
      open={!!created}
      onOpenChange={(open) => !open && onClose()}>
      {created && (
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="bg-success/15 text-success-foreground flex size-8 items-center justify-center rounded-full">
                <KeyRound className="size-4" />
              </span>
              “{created.info.name}” is ready
            </DialogTitle>
            <DialogDescription>Paste this link into your AI assistant. That’s all it needs.</DialogDescription>
          </DialogHeader>
          <ConnectInstructions
            connectorUrl={created.connectorUrl}
            token={created.token}
          />
          <Alert>
            <ShieldAlert />
            <AlertTitle>Treat this like a password</AlertTitle>
            <AlertDescription>
              Anyone with this link can act as your agent. It’s saved in this browser so you can copy it again, and you
              can remove access any time on the Agents page.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function ConnectInstructions({ connectorUrl, token }: { connectorUrl: string; token: string }) {
  const base = connectorUrl.replace(/\/mcp\/[\w-]+$/, '/mcp');
  return (
    <Tabs defaultValue="claude">
      <TabsList className="w-full">
        <TabsTrigger value="claude">
          <MessageSquare />
          Claude
        </TabsTrigger>
        <TabsTrigger value="chatgpt">
          <Sparkles />
          ChatGPT
        </TabsTrigger>
        <TabsTrigger value="code">
          <Terminal />
          Claude Code
        </TabsTrigger>
        <TabsTrigger value="other">
          <Laptop />
          Other
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="claude"
        className="space-y-3 pt-2">
        <CopyField
          label="Link"
          value={connectorUrl}
          secret
        />
        <Steps
          steps={[
            'In claude.ai or Claude Desktop, open Settings → Connectors.',
            'Click “Add custom connector”, name it “Valio Aimo”, paste the URL. Leave authentication empty.',
            'In a chat, enable it from the tools menu and ask: “I need 1,000 litres of lactose-free milk by Monday.”',
          ]}
        />
      </TabsContent>
      <TabsContent
        value="chatgpt"
        className="space-y-3 pt-2">
        <CopyField
          label="Link"
          value={connectorUrl}
          secret
        />
        <Steps
          steps={[
            'In ChatGPT settings, enable developer mode for apps/connectors (availability depends on your plan).',
            'Create a connector with this URL and no authentication.',
            'Select it in a chat. The same widgets render, because both apps support MCP Apps.',
          ]}
        />
      </TabsContent>
      <TabsContent
        value="code"
        className="space-y-3 pt-2">
        <CopyField
          label="Command"
          value={`claude mcp add --transport http valio-aimo ${connectorUrl}`}
          secret
        />
        <p className="text-muted-foreground text-xs">Run in a terminal, then start Claude Code and ask it to buy something.</p>
      </TabsContent>
      <TabsContent
        value="other"
        className="space-y-3 pt-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">Streamable HTTP endpoint</Label>
          <CopyField
            label="Endpoint"
            value={base}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Authorization header</Label>
          <CopyField
            label="Header"
            value={`Authorization: Bearer ${token}`}
            secret
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li
          key={s}
          className="flex gap-3 text-sm">
          <span className="bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
            {i + 1}
          </span>
          <span className="text-muted-foreground">{s}</span>
        </li>
      ))}
    </ol>
  );
}
