import type { ChangeEvent } from '@valio/shared';
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publishChange(event: ChangeEvent) {
  emitter.emit('change', event);
}

export function onChange(listener: (event: ChangeEvent) => void): () => void {
  emitter.on('change', listener);
  return () => emitter.off('change', listener);
}
