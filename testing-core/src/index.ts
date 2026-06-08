import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { readPort } from './serverUtils.js';
import { PlaywrightBrowserEngine } from './infrastructure/playwright/PlaywrightBrowserEngine.js';
import { SocketTelemetryGateway } from './infrastructure/socket/SocketTelemetryGateway.js';
import { StartExplorationUseCase } from './application/useCases/StartExplorationUseCase.js';
import { registerRoutes } from './presentation/api/registerRoutes.js';
import { registerAuthRoutes } from './presentation/api/authController.js';
import { registerSocketHandlers } from './presentation/socket/registerSocketHandlers.js';
import { connectDatabase, disconnectDatabase, getConnectionState, ensureConnected } from './infrastructure/database/mongooseClient.js';
import { MongoFindingRepository } from './infrastructure/database/repositories/MongoFindingRepository.js';

const port = readPort(process.env.BUGSAFARI_PORT ?? process.env.BUGSAFARI_API_PORT, 3000);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

registerSocketHandlers(io);

// Debug endpoint to verify database collections
app.get('/api/debug/db', async (req, res) => {
  try {
    const { isConnected, error } = getConnectionState();
    if (!isConnected || error) {
      res.json({ status: 'disconnected', error: error?.message, collections: [] });
      return;
    }
    const mongoose = await import('mongoose');
    const db = mongoose.default.connection.db;
    if (!db) {
      res.json({ status: 'connected', dbName: mongoose.default.connection.name, collections: [], message: 'Database object not initialized' });
      return;
    }

    const collections = await db.listCollections().toArray() as Array<{ name: string }>;
    res.json({
      status: 'connected',
      dbName: mongoose.default.connection.name,
      collections: collections.map(c => c.name)
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const telemetryGateway = new SocketTelemetryGateway(io);

// Connect to database and wait for it to complete before registering routes
// This ensures DB is ready before any auth requests are handled
const dbReady = await connectDatabase();
if (!dbReady) {
  console.error('[BugSafari] ⚠️ Database connection failed - auth features may be unavailable');
}

const findingRepository = dbReady ? new MongoFindingRepository() : undefined;
const browserEngine = new PlaywrightBrowserEngine(findingRepository);
// Default userId for server-side execution (would be replaced with authenticated user ID in production)
const useCase = new StartExplorationUseCase(browserEngine, telemetryGateway, { active: false }, '000000000000000000000000');
registerAuthRoutes(app);
registerRoutes(app, useCase, port, findingRepository);
httpServer.listen(port, () => {
  console.log(`[BugSafari] API + Socket bridge listening on http://localhost:${port}`);
});

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[BugSafari] Port ${port} is already in use. Stop the existing process or set BUGSAFARI_PORT.`);
    return;
  }
  console.error('[BugSafari] Server startup error:', error.message);
});

// Graceful shutdown handler
const shutdown = async (signal: string): Promise<void> => {
  console.log(`[BugSafari] Received ${signal}, shutting down gracefully...`);
  try {
    await disconnectDatabase();
    console.log('[BugSafari] Database disconnected');
  } catch (err) {
    console.error('[BugSafari] Error during shutdown:', err);
  }
  httpServer.close(() => {
    console.log('[BugSafari] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if server doesn't close
  setTimeout(() => {
    console.error('[BugSafari] Forced exit after timeout');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
