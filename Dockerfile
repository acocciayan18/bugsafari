# Use Microsoft's official Playwright Linux core container containing all browser hooks
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# 1. Copy package configurations first to build structure caches
COPY package*.json ./
COPY testing-core/package.json ./testing-core/package.json
COPY shared/package.json ./shared/package.json

# 2. Install ALL workspaces globally inside the container
RUN npm ci

# 3. Copy the rest of your local codebase into the container filesystem space
COPY testing-core ./testing-core
COPY shared ./shared

# 4. Compile our shared models FIRST before the brain loops
RUN npm run build --workspace shared --if-present

# 5. Build the TypeScript scripts inside testing-core into executable JS targets
RUN npm run build --workspace testing-core

# Expose our core REST / WebSocket API port to the local host machine layout
EXPOSE 3000

# 6. FIXED EXECUTION ENTRYPOINT PATH: Points to the true nested dist bundle
CMD ["node", "testing-core/dist/testing-core/src/index.js"]