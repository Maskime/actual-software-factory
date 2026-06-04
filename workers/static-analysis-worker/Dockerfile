FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Minimal workspace root so npm resolves @factory/worker-shared from the local shared/ package
RUN echo '{"private":true,"workspaces":["shared","static-analysis-worker"]}' > package.json
COPY shared/package.json ./shared/
COPY static-analysis-worker/package.json static-analysis-worker/tsconfig.json ./static-analysis-worker/
RUN npm install --workspaces
COPY shared/src ./shared/src
COPY static-analysis-worker/src ./static-analysis-worker/src
WORKDIR /app/static-analysis-worker
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN echo '{"private":true,"workspaces":["shared","static-analysis-worker"]}' > package.json
COPY shared/package.json ./shared/
COPY shared/src ./shared/src
COPY static-analysis-worker/package.json ./static-analysis-worker/
RUN npm install --omit=dev --workspaces
WORKDIR /app/static-analysis-worker
COPY --from=builder /app/static-analysis-worker/dist ./dist
USER node
CMD ["node", "dist/worker.js"]
