# Use Microsoft's official Playwright Linux core container containing all browser hooks
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# 1. Copy package configurations first to build structure caches
COPY package*.json ./
COPY testing-core/package.json ./testing-core/package.json
COPY shared/package.json ./shared/package.json

# 2. FIXED: Include BOTH shared and testing-core so npm creates node_modules/@bugsafari/shared
RUN npm ci --workspace testing-core --workspace shared --include-workspace-root

# 3. Copy source files for shared and testing-core
COPY testing-core ./testing-core
COPY shared ./shared

# 4. Compile shared package FIRST
RUN npm run build --workspace shared --if-present

# 5. Build testing-core engine
RUN npm run build --workspace testing-core

# 5b. Drop dev-only dependencies from the runtime image. Production start scripts run
# `node dist/...` (never tsx/tsc-watch), so typescript, tsx, tsc-watch, @playwright/test
# and @types/* are unused at runtime — pruning them shrinks the image and speeds the
# in-place `git pull && up --build` cycle on a droplet with no image registry.
RUN npm prune --omit=dev

# Expose REST / WebSocket API port
EXPOSE 3000

# 6. Execution entrypoint
CMD ["node", "testing-core/dist/testing-core/src/index.js"]