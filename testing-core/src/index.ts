import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { readPort } from './serverUtils.js';
import { PlaywrightBrowserEngine } from './infrastructure/playwright/PlaywrightBrowserEngine.js';
import { SocketTelemetryGateway } from './infrastructure/socket/SocketTelemetryGateway.js';
import { StartExplorationUseCase } from './application/useCases/StartExplorationUseCase.js';
import { registerRoutes } from './presentation/api/registerRoutes.js';
import { registerSocketHandlers } from './presentation/socket/registerSocketHandlers.js';

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
const browserEngine = new PlaywrightBrowserEngine();
const useCase = new StartExplorationUseCase(browserEngine, telemetryGateway, { active: false });

registerRoutes(app, useCase, port);

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
