import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Button } from '@/components/ui/button';
import { copy } from '@/lib/format';

export function CopyField({ value, secret, label }: { value: string; secret?: boolean; label?: string }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const masked = value.replace(/aimo_[\w-]+/, (t) => `${t.slice(0, 12)}${'•'.repeat(18)}`);
  return (
    <InputGroup className="font-mono">
      <InputGroupInput
        readOnly
        aria-label={label}
        value={shown ? value : masked}
        className="font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        {secret && (
          <InputGroupButton
            size="icon-xs"
            aria-label={shown ? 'Hide' : 'Show'}
            onClick={() => setShown(!shown)}>
            {shown ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        )}
        <InputGroupButton
          size="icon-xs"
          aria-label="Copy"
          onClick={async () => {
            if (await copy(value)) {
              setCopied(true);
              toast.success(`${label ?? 'Value'} copied`);
              setTimeout(() => setCopied(false), 1500);
            }
          }}>
          {copied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export function CopyButton({ value, label, children }: { value: string; label: string; children?: React.ReactNode }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        if (await copy(value)) toast.success(`${label} copied`);
      }}>
      <Copy />
      {children ?? `Copy ${label.toLowerCase()}`}
    </Button>
  );
}
