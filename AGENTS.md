# Repository Guidelines

## Project Structure & Module Organization

This npm workspaces monorepo contains TypeScript applications:

- `apps/web`: React/Vite Aimo Assistant; active chat code lives in `src/assistant`, with shared UI in `src/components` and assets in `public` and `src/assets`. Older shop pages remain under `src/pages`.
- `apps/console`: React/Vite buyer console for tokens, approvals, orders, and audit history.
- `apps/mcp`: agent gateway, purchasing logic, MCP widgets (`widget/`), and colocated tests (`src/*.test.ts`).
- `apps/api`: Fastify API with SQLite persistence and handlers in `src/routes`.
- `packages/shared`: shared Zod schemas, TypeScript types, and product catalog.
- `scripts/`: catalog utilities; `_old/`: archived implementation, not the primary development target.

## Build, Test, and Development Commands

Use Node.js 22.13 or newer. Run commands from the repository root:

- `npm install`: install all workspace dependencies.
- `npm run dev`: start the MCP gateway and Assistant development servers.
- `npm run dev:console`: start the console development server separately.
- `npm run dev:api`: start the Fastify API in watch mode.
- `npm run build`: build the API and web application.
- `npm run build:gateway`: build the console, web application, and gateway; `npm run start:gateway` serves the result.
- `npm run typecheck`: check types across configured workspaces.
- `npm run lint --workspace @valio/web`: run the web ESLint checks.
- `npm test --workspace @valio/mcp`: run gateway tests.

## Coding Style & Naming Conventions

Follow `.prettierrc`: two-space indentation, single quotes, semicolons, 110-column width, and one JSX attribute per line. Format changed files with `npx prettier --write <paths>`. Use TypeScript ES modules, PascalCase component identifiers, camelCase functions, and `use-*` hook filenames. Match neighboring file naming. Keep reusable contracts in `packages/shared`; web ESLint includes TypeScript and React Hooks rules.

## Testing Guidelines

Gateway tests use Node's built-in test runner with `tsx`. Colocate regression tests as `*.test.ts`; the gateway test script explicitly lists files, so register new suites there. No coverage threshold is configured. Run relevant tests, type checks, and builds before submitting; manually verify affected Assistant or console flows for UI changes.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so existing commit conventions cannot be verified. Use concise, imperative commit subjects describing a focused change. PRs should explain behavior changes, identify affected workspaces, link relevant issues, and list validation commands and results. Include screenshots for visible UI changes.

## Security & Configuration

Keep API keys and connector tokens out of commits. Use local environment files; keep Gemini credentials server-side in the gateway. Do not commit SQLite databases, generated builds, or dependency directories.