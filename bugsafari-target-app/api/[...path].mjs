// Vercel serverless entry: serves the full Express mock API for every /api route.
// Local dev/tunnel still runs the same app via scripts/serve.mjs, unchanged.
import { createApp } from '../server/index.mjs';

// Built once per cold start, reused across invocations (Fluid Compute instance reuse).
export default createApp();
