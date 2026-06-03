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
import { connectDatabase, disconnectDatabase, getConnectionState } from './infrastructure/database/mongooseClient.js';
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

const telemetryGateway = new SocketTelemetryGateway(io);
void connectDatabase().then((dbReady) => {
  const findingRepository = dbReady ? new MongoFindingRepository() : undefined;
  const browserEngine = new PlaywrightBrowserEngine(findingRepository);
  const useCase = new StartExplorationUseCase(browserEngine, telemetryGateway, { active: false });
  registerAuthRoutes(app);
  registerRoutes(app, useCase, port, findingRepository);
  httpServer.listen(port, () => {
    console.log(`[BugSafari] API + Socket bridge listening on http://localhost:${port}`);
  });
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
