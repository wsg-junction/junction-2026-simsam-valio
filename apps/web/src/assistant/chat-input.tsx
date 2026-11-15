import { ArrowUp, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** The big ChatGPT-style composer: grows with the text, Enter sends, Shift+Enter adds a line. */
export function ChatInput({
  onSend,
  disabled,
  autoFocus,
  placeholder = 'Ask Aimo to buy, plan or check anything…',
  large,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  large?: boolean;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        'bg-card focus-within:border-ring/60 relative flex w-full flex-col rounded-3xl border shadow-sm transition-colors',
        large ? 'p-3' : 'p-2',
      )}>
      <label
        htmlFor="composer"
        className="sr-only">
        Message
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={large ? 2 : 1}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className={cn(
          'placeholder:text-muted-foreground w-full resize-none bg-transparent px-3 py-2 outline-none',
          large ? 'text-base' : 'text-[15px]',
        )}
      />
      <div className="flex items-center justify-between px-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground rounded-full"
              aria-label="Attach a delivery note (not in the demo)"
              disabled>
              <Paperclip />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Attachments aren’t part of the demo</TooltipContent>
        </Tooltip>
        <Button
          type="submit"
          size="icon-sm"
          className="rounded-full"
          disabled={disabled || !text.trim()}
          aria-label="Send">
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}
