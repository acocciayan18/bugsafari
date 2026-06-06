# Use Microsoft's official Playwright Linux core container containing all browser hooks
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# 1. Copy package configurations first to establish workspace structures
COPY package*.json ./
COPY testing-core/package.json ./testing-core/package.json
COPY shared/package.json ./shared/package.json

# 2. CRITICAL FIX: Copy the source folders BEFORE running npm ci.
# This ensures npm workspaces can map and link packages without a lockfile mismatch.
COPY testing-core ./testing-core
COPY shared ./shared

# 3. Clean install all dependencies across the entire workspace tree
RUN npm ci

# 4. Compile our shared models (Runs the dummy echo script successfully)
RUN npm run build --workspace shared

# 5. Build the TypeScript scripts inside testing-core into executable JS targets
RUN npm run build --workspace testing-core

# Expose our core REST / WebSocket API port to the local host machine layout
EXPOSE 3000

# 6. FIXED ENTRYPOINT PATH: Points to your compiled JS targets
CMD ["node", "testing-core/dist/index.js"]