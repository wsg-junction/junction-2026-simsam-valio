import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { useSyncExternalStore } from 'react';
import type { WidgetPayload } from '../../src/types';

// Connection to the MCP host (Claude, ChatGPT, ...). The host pushes the tool input/result into this iframe;
// the widget can call server tools, send follow-up messages and open links through it.

export interface WidgetState {
  status: 'connecting' | 'waiting' | 'ready' | 'error';
  payload?: WidgetPayload;
  error?: string;
}

let state: WidgetState = { status: 'connecting' };
const listeners = new Set<() => void>();
function setState(next: Partial<WidgetState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const app = new App({ name: 'valio-aimo-widget', version: '0.1.0' }, {}, { autoResize: true });

function applyHostContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

// Handlers must be registered before connect(), or the first notifications can be missed.
app.ontoolinput = () => setState({ status: 'waiting' });
app.ontoolresult = (result) => {
  const text = result.content?.find((c) => c.type === 'text');
  if (result.isError) {
    setState({ status: 'error', error: text && 'text' in text ? text.text : 'The tool call failed' });
  } else if (result.structuredContent) {
    setState({ status: 'ready', payload: result.structuredContent as unknown as WidgetPayload });
  }
};
app.onhostcontextchanged = applyHostContext;

app
  .connect()
  .then(() => {
    applyHostContext(app.getHostContext());
    if (state.status === 'connecting') setState({ status: 'waiting' });
  })
  .catch((err: unknown) => setState({ status: 'error', error: `Could not connect to host: ${String(err)}` }));

export function useWidgetState(): WidgetState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export type ToolOutcome =
  | { ok: true; payload: WidgetPayload }
  | { ok: false; error: string; /** host refused or doesn't support tool calls from the widget */ unsupported: boolean };

/** Calls a gateway tool directly from the widget (the user's click), without going through the model. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    const res = await app.callServerTool({ name, arguments: args });
    const text = res.content?.find((c) => c.type === 'text');
    const message = text && 'text' in text ? text.text : 'The request failed';
    if (res.isError) return { ok: false, error: message, unsupported: false };
    if (!res.structuredContent) return { ok: false, error: message, unsupported: false };
    return { ok: true, payload: res.structuredContent as unknown as WidgetPayload };
  } catch (err) {
    return { ok: false, error: String(err), unsupported: true };
  }
}

/** Quietly tells the model what the user did in the widget, so its next answer is accurate. */
export function tellModel(text: string) {
  app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => {});
}

/** Asks the model to continue, as if the user typed it. Fallback when the host doesn't allow direct tool calls. */
export async function say(text: string): Promise<boolean> {
  try {
    const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
    return !res.isError;
  } catch {
    return false;
  }
}

export async function openLink(url: string) {
  try {
    await app.openLink({ url });
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
