import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // The shared package ships TypeScript sources, so bundle it in.
  noExternal: ['@valio/shared'],
  // `node:sqlite` only exists with the prefix.
  removeNodeProtocol: false,
  clean: true,
});
