# node:22-slim (Debian) intentionally chosen over alpine — agents require libc for native
# deps and git credential helpers that Alpine's musl libc doesn't support
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
# git: needed at runtime — agents clone and push repos into /tmp/factory
# typescript (global): needed at runtime — agents compile dynamically generated TypeScript
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g typescript \
    && mkdir -p /tmp/factory \
    && chown node:node /tmp/factory
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/worker.js"]
