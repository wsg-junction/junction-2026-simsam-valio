# Gateway (MCP + widgets), Agent Console and Aimo Assistant in one image. Build from the repository root:
#   docker build -f apps/mcp/Dockerfile -t valio-aimo-mcp .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/mcp/package.json apps/mcp/
COPY apps/console/package.json apps/console/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @valio/mcp --workspace @valio/console --workspace @valio/web --workspace @valio/shared --include-workspace-root=false
COPY apps/mcp apps/mcp
COPY apps/console apps/console
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN npm run build --workspace @valio/console && npm run build --workspace @valio/web && npm run build --workspace @valio/mcp

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 CONSOLE_DIR=/app/console WEB_DIR=/app/web DATA_DIR=/app/data
# server.js is bundled except the MCP SDKs and zod, which come from node_modules.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/mcp/dist ./dist
COPY --from=build /repo/apps/console/dist ./console
COPY --from=build /repo/apps/web/dist ./web
COPY apps/mcp/package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
EXPOSE 8787
USER node
CMD ["node", "dist/server.js"]
