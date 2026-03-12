# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Only install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy source + migrations for TypeORM CLI (migration:run, migration:revert)
COPY --from=builder /app/src ./src
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules/ts-node ./node_modules/ts-node
COPY --from=builder /app/node_modules/typescript ./node_modules/typescript

# Set ownership
RUN chown -R appuser:appgroup /app
USER appuser

# Expose API port (Railway overrides via PORT env var)
EXPOSE ${PORT:-3009}

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-3009}/health || exit 1

ENV NODE_ENV=production

CMD ["node", "dist/main"]
