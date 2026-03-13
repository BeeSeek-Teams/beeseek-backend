# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

# Install Chromium + dependencies for Puppeteer PDF generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer where Chromium lives
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Remove crashpad handler that causes "chrome_crashpad_handler: --database is required" errors
# in containerised environments — crash reporting is not needed in production containers
RUN rm -f /usr/bin/chrome_crashpad_handler /usr/lib/chromium/chrome_crashpad_handler /usr/lib/chromium-browser/chrome_crashpad_handler 2>/dev/null || true

# Security: run as non-root
RUN groupadd -r appgroup && useradd -r -g appgroup -G audio,video appuser

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
