# Oura dashboard + MCP server
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8484 OURA_TOKEN_PATH=/data/tokens.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8484
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8484/healthz || exit 1
CMD ["node", "dist/index.js", "web"]
