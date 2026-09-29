# syntax=docker/dockerfile:1

# Dev: deps live in the image; bind-mount src/ (and tsconfig.json) into /app
# for hot reload: tsc --watch recompiles, node --watch restarts the server.
FROM node:24-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
CMD ["sh", "-c", "npm run build && (npx tsc --watch --preserveWatchOutput & exec node --watch dist/http.js)"]

# Builder: compile TypeScript, drop tests and dev dependencies
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && rm -f dist/*.test.* && npm prune --omit=dev
# Empty data dir owned by the runtime user (distroless has no shell to create it)
RUN mkdir /data && chown 65532:65532 /data

# Production: distroless Node 24, non-root, dist/ + production node_modules only.
# Works with a read-only root filesystem; only /data (SQLite) and /tmp need to be writable.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS production
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder --chown=65532:65532 /data /data
USER 65532:65532
EXPOSE 8080
CMD ["dist/http.js"]
