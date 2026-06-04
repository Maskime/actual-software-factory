FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Minimal workspace root so npm resolves @factory/worker-shared from the local shared/ package
RUN echo '{"private":true,"workspaces":["shared","review-fix-worker"]}' > package.json
COPY shared/package.json ./shared/
COPY review-fix-worker/package.json review-fix-worker/tsconfig.json ./review-fix-worker/
RUN npm install --workspaces
COPY shared/src ./shared/src
COPY review-fix-worker/src ./review-fix-worker/src
WORKDIR /app/review-fix-worker
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN echo '{"private":true,"workspaces":["shared","review-fix-worker"]}' > package.json
COPY shared/package.json ./shared/
COPY shared/src ./shared/src
COPY review-fix-worker/package.json ./review-fix-worker/
RUN npm install --omit=dev --workspaces
WORKDIR /app/review-fix-worker
COPY --from=builder /app/review-fix-worker/dist ./dist
USER node
CMD ["node", "dist/worker.js"]
