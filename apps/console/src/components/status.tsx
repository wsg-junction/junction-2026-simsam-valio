import { CheckCircle2, Clock, PencilLine, Repeat, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Order } from '@/lib/api';

const STATUS = {
  confirmed: { label: 'Confirmed', icon: CheckCircle2, className: 'bg-success/15 text-success-foreground' },
  pending_approval: { label: 'Needs approval', icon: Clock, className: 'bg-warning/20 text-warning-foreground' },
  rejected: { label: 'Rejected', icon: XCircle, className: 'bg-destructive/15 text-destructive' },
  changes_requested: { label: 'Waiting for revision', icon: PencilLine, className: 'bg-primary/10 text-primary' },
  revised: { label: 'Revised', icon: Repeat, className: 'bg-muted text-muted-foreground' },
} as const;

export function OrderStatus({ status, className }: { status: Order['status']; className?: string }) {
  const s = STATUS[status];
  return (
    <Badge
      variant="secondary"
      className={cn('gap-1 border-transparent', s.className, className)}>
      <s.icon className="size-3" />
      {s.label}
    </Badge>
  );
}

export function Pill({
  tone,
  children,
  className,
}: {
  tone: 'success' | 'warning' | 'muted' | 'info' | 'destructive';
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    success: 'bg-success/15 text-success-foreground',
    warning: 'bg-warning/20 text-warning-foreground',
    muted: 'bg-muted text-muted-foreground',
    info: 'bg-primary/10 text-primary',
    destructive: 'bg-destructive/15 text-destructive',
  };
  return (
    <Badge
      variant="secondary"
      className={cn('gap-1 border-transparent font-medium', tones[tone], className)}>
      {children}
    </Badge>
  );
}
