# Distributed BugSafari Architecture - Implementation Plan

## Architecture Name
**"Safari Fleet" / Queue-Driven Browser-as-a-Service (BaaS) Architecture**

## Current State Analysis
| Component | Current | Target |
|-----------|---------|--------|
| Execution Model | Monolithic (single process) | Distributed (queue-driven) |
| Browser Lifecycle | Inline with HTTP request | Isolated worker process |
| Concurrency | No queue, crashes under load | BullMQ with concurrency limit |
| Containerization | None | Docker + Playwright image |

---

## Phase 1: Docker Containerization ✅

### Step 1.1: Create Dockerfile
```dockerfile
FROM mcr.microsoft.com/playwright:latest

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci

# Copy application code
COPY . .

# Expose ports
EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### Step 1.2: Create docker-compose.yml
```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_URL=redis://redis:6379
      - MONGODB_URI=mongodb://mongo:27017
    depends_on:
      - redis
      - mongo

  worker:
    build: .
    command: ["node", "dist/worker.js"]
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  mongo:
    image: mongo:6
    ports:
      - "27017:27017"
```

---

## Phase 2: Queue & Worker Setup ✅

### Step 2.1: Install BullMQ
```bash
npm install bullmq ioredis
```

### Step 2.2: Create Job Queue (src/infrastructure/queue/jobQueue.ts)
```typescript
import { Queue, Worker, Job } from 'bullmq';
import { createClient } from 'redis';

const connection = createClient({ url: process.env.REDIS_URL });

export const explorationQueue = new Queue('exploration-jobs', { connection });

export function createExplorationWorker(
  processor: (job: Job) => Promise<void>
) {
  return new Worker('exploration-jobs', processor, {
    connection,
    concurrency: 1, // Limit to 1-2 for RAM stability
  });
}
```

### Step 2.3: Modify API to Enqueue Jobs
```typescript
// POST /api/explore -> adds job to queue, returns jobId
app.post('/api/explore', async (req, res) => {
  const { targetUrl } = req.body;
  const job = await explorationQueue.add('exploration', { targetUrl });
  res.json({ jobId: job.id, status: 'queued' });
});
```

---

## Phase 3: Cloud Infrastructure (Simplified for MVP)

### Recommended Setup (Single Railway for MVP)
```
┌─────────────────────────────────────┐
│          Railway                    │
│  ┌─────────┐    ┌────────────────┐ │
│  │  API    │    │   Worker       │ │
│  │ Gateway │◄───│ (BullMQ       │ │
│  │         │    │  Processor)    │ │
│  └────┬────┘    └────────────────┘ │
│       │                              │
│  ┌────▼────────────────────────┐   │
│  │    Socket.io Bridge          │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
              │
        ┌─────▼─────┐
        │  Upstash  │
        │  (Redis)  │
        └───────────┘
```

### Later: Add Vercel Frontend
- After MVP stability → Deploy `developer-dashboard/` to Vercel
- Points to Railway API URL

---

## Phase 4: CI/CD Pipeline (Optional for MVP)

### .github/workflows/deploy.yml (Deferred)
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying to Railway..."
```

---

## Implementation Priority Order

| Priority | Task | Complexity |
|----------|------|------------|
| P0 | Create Dockerfile | Medium |
| P0 | Set up BullMQ queue | Medium |
| P0 | Create worker processor | Medium |
| P1 | Modify API to enqueue jobs | Low |
| P1 | Add job status polling endpoint | Low |
| P2 | Add result transport (frames/logs) | High |
| P2 | Frame compression for bandwidth | Medium |
| P3 | Railway deployment config | Medium |
| P3 | Vercel frontend deployment | Low |

---

## Key Gaps to Address

### 1. Frame Transport in Distributed Setup
**Problem**: Worker runs in separate container → how to stream frames to dashboard?

**Solution Options**:
- Option A: Worker pushes to Redis channel → API subscribes → emits via Socket.io
- Option B: Worker makes HTTP callback to API after each frame

**Recommended**: Option A (Redis pub/sub for telemetry)

### 2. Job Persistence
- Jobs auto-persist in Redis (BullMQ handles this)
- Add checkpointing if Worker crash mid-run needs recovery

### 3. RAM Management
- Set `concurrency: 1` initially
- Monitor Railway RAM usage, scale to `concurrency: 2` if stable

---

## Notes

- **Phase 3 (Vercel split) is premature** for student MVP
- **Phase 4 (CI/CD) is optional** — can be added later
- Start with: **Docker + BullMQ + Redis only**
