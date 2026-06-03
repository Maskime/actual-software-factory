# node:22-slim (Debian) intentionally chosen over alpine — agents require libc for native
# deps and git credential helpers that Alpine's musl libc doesn't support
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
# Minimal workspace root so npm resolves @factory/worker-shared from the local shared/ package
RUN echo '{"private":true,"workspaces":["shared","agents"]}' > package.json
COPY shared/package.json ./shared/
COPY agents/package.json agents/tsconfig.json ./agents/
RUN npm install --workspaces
COPY shared/src ./shared/src
COPY agents/src ./agents/src
WORKDIR /app/agents
RUN npm run build

FROM node:22-slim
WORKDIR /app
# git: needed at runtime — agents clone and push repos into /tmp/factory
# typescript (global): needed at runtime — agents compile dynamically generated TypeScript
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g typescript \
    && mkdir -p /tmp/factory \
    && chown node:node /tmp/factory \
    && echo '{"private":true,"workspaces":["shared","agents"]}' > package.json
COPY shared/package.json ./shared/
COPY shared/src ./shared/src
COPY agents/package.json ./agents/
RUN npm install --omit=dev --workspaces
WORKDIR /app/agents
COPY --from=builder /app/agents/dist ./dist
USER node
CMD ["node", "dist/worker.js"]
