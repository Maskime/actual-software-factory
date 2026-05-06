FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY app/ ./app/
COPY server/ ./server/
COPY public/ ./public/
COPY nuxt.config.ts tsconfig.json tailwind.config.ts ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/.output /app/.output
ENV NUXT_PORT=3000
EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
