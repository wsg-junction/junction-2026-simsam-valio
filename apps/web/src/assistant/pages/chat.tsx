import { Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { api, greeting, useLive } from '../api';
import { AttentionFeed } from '../attention';
import { CardView } from '../cards';
import { ChatInput } from '../chat-input';
import { useChats, type ChatMessage } from '../chats';
import { useAssistant, useThinking } from '../use-conversation';

const STARTERS = [
  'I need 1,000 L of lactose-free milk by Monday',
  'Breakfast for 180 guests, 20 vegan, budget €450',
  'What is running low?',
  'Any supplier problems?',
];

function TopBar({ title }: { title?: string }) {
  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-12 items-center gap-2 px-3 backdrop-blur">
      <SidebarTrigger />
      {title && <span className="truncate text-sm font-medium">{title}</span>}
    </header>
  );
}

/** New chat: a big centered composer, and what needs attention underneath. */
export function HomePage() {
  const { send } = useAssistant();
  const { data: attention, refresh } = useLive(api.attention, 6000);
  const [params, setParams] = useSearchParams();
  const started = useRef(false);

  // Deep link: /assistant/?q=… starts a chat with that message.
  useEffect(() => {
    const q = params.get('q');
    if (!q || started.current) return;
    started.current = true;
    setParams({}, { replace: true });
    send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-svh flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-[12vh] pb-12">
        <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          {greeting()}, Maria. <span className="text-muted-foreground">What should we buy?</span>
        </h1>
        <ChatInput
          large
          autoFocus
          onSend={(t) => send(t)}
        />
        <EngineNote />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {STARTERS.map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className="text-muted-foreground h-auto max-w-full rounded-full py-1.5 font-normal whitespace-normal"
              onClick={() => send(s)}>
              {s}
            </Button>
          ))}
        </div>

        <section className="mt-12 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Coming up</h2>
            {attention && attention.length > 0 && (
              <span className="text-muted-foreground text-xs">{attention.length} things to look at</span>
            )}
          </div>
          <AttentionFeed
            items={attention}
            onChanged={refresh}
          />
        </section>
      </main>
    </div>
  );
}

/** A conversation: messages with cards, and the composer docked at the bottom. */
export function ChatPage() {
  const { id = '' } = useParams();
  const chats = useChats();
  const chat = chats.find((c) => c.id === id);
  const { send } = useAssistant();
  const thinking = useThinking(id);
  const { data: info } = useLive(api.info, 60000);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat?.messages.length, thinking]);

  if (!chat) return <Navigate to="/" replace />;
  const last = chat.messages.at(-1);

  return (
    <div className="flex min-h-svh flex-col">
      <TopBar title={chat.title} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 pt-4 pb-40">
        {chat.messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            conversationId={chat.id}
          />
        ))}
        {thinking && <Typing />}
        {!thinking && last?.role === 'assistant' && last.suggestions && last.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-10">
            {last.suggestions.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                className="h-auto max-w-full rounded-full py-1.5 font-normal whitespace-normal"
                onClick={() => send(s, chat.id)}>
                {s}
              </Button>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </main>
      <div className="from-background via-background sticky bottom-0 bg-gradient-to-t from-60% to-transparent px-4 pt-6 pb-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            autoFocus
            disabled={thinking}
            placeholder="Reply to Aimo…"
            onSend={(t) => send(t, chat.id)}
          />
          <p className="text-muted-foreground mt-2 text-center text-[11px]">
            {info?.assistant.supplier === 'valio-api' ? 'Challenge API · Synthetic data · Live prices and availability; estimates do not reserve stock or submit orders.' : 'Demo with synthetic data. Orders follow your limits and requirements; anything outside them waits for you.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Which engine answers: Gemini, or the offline rule-based demo. */
function EngineNote() {
  const { data: info } = useLive(api.info, 60000);
  if (!info) return null;
  return (
    <p className="text-muted-foreground mt-2 text-center text-xs">
      {info.assistant.supplier === 'valio-api' ? 'Valio Aimo API · Live prices and availability · Combined estimates; order submission is not connected.' : info.assistant.engine === 'gemini'
        ? `Answers by Google Gemini (${info.assistant.model}). Orders still follow your limits and requirements.`
        : 'Demo with synthetic data. Orders follow your limits and requirements.'}
    </p>
  );
}

function Avatar() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-700 text-white">
      <Sparkles className="size-3.5" />
    </span>
  );
}

function Message({ message: m, conversationId }: { message: ChatMessage; conversationId: string }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-muted max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] whitespace-pre-wrap">{m.text}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-2 text-[15px] leading-relaxed">{m.text.split(/\n\s*\n/).map((paragraph, i) => <p key={i} className="whitespace-pre-wrap">{paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, j) => part.startsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part)}</p>)}</div>
        {m.cards?.map((c, i) => (
          <CardView
            key={i}
            card={c}
            conversationId={conversationId}
          />
        ))}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-3">
      <Avatar />
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('bg-muted-foreground/50 size-1.5 animate-bounce rounded-full')}
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
