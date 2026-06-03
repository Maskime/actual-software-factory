FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Minimal workspace root so npm resolves @factory/worker-shared from the local shared/ package
RUN echo '{"private":true,"workspaces":["shared","review-worker"]}' > package.json
COPY shared/package.json ./shared/
COPY review-worker/package.json review-worker/tsconfig.json ./review-worker/
RUN npm install --workspaces
COPY shared/src ./shared/src
COPY review-worker/src ./review-worker/src
WORKDIR /app/review-worker
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN echo '{"private":true,"workspaces":["shared","review-worker"]}' > package.json
COPY shared/package.json ./shared/
COPY shared/src ./shared/src
COPY review-worker/package.json ./review-worker/
RUN npm install --omit=dev --workspaces
WORKDIR /app/review-worker
COPY --from=builder /app/review-worker/dist ./dist
USER node
CMD ["node", "dist/worker.js"]
