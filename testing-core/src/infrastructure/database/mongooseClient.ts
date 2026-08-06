/**
 * Mongoose Database Client - Singleton Connection Manager
 * Provides centralized database connection with production cloud optimizations.
 */

import mongoose from 'mongoose';
import type { ConnectOptions } from 'mongoose';

import { createLogger } from '../observability/logger.js';
import { resolveMongoUri } from '../../config/env.js';

const obsLog = createLogger('[mongooseClient]');

const isLocal = (uri: string): boolean => uri.includes('localhost') || uri.includes('127.0.0.1');

/**
 * Get optimized mongoose connection options based on environment.
 */
function getMongooseOptions(): ConnectOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  const uri = getDatabaseUri();
  const isLocalEnv = isLocal(uri);
  // A worker runs one exploration and issues a handful of concurrent queries; the
  // api fans out across many requests. Ten sockets per worker is wasted memory and
  // Atlas connection budget (3 processes x 10 = 30 held), so halve it for workers.
  const isWorker = process.env.BUGSAFARI_ROLE === 'worker';

  const options: ConnectOptions = {
    // Explicitly force the database name to prevent falling back to system databases
    dbName: 'bugsafari',

    // Connection pool size - bounded for free-tier databases, smaller for workers
    maxPoolSize: isWorker ? 5 : 10,
    minPoolSize: 0,

    // Server selection timeout - automatic reconnection
    serverSelectionTimeoutMS: 5000,

    // Socket configuration for network stability
    socketTimeoutMS: 45000,
    // Buffer commands during connection drops
    bufferCommands: true,

// Production: Disable auto-indexing to prevent performance blocks on Atlas
    // Local development: Keep enabled for convenience
    ...(isProduction ? { autoIndex: false } : { autoIndex: true }),

    // zlib wire compression: Atlas is off-box, so every forensic batch insert and
    // history read crosses the public network. zlib is built into Node (unlike the
    // optional zstd/snappy native deps that caused MongoMissingDependencyError), so
    // no package is required. Level 1 captures most of the win on repetitive JSON
    // (stack traces, URLs, repeated keys) at minimal CPU cost.
    compressors: ['zlib'],
    zlibCompressionLevel: 1,
  };

  return options;
}

/**
 * URI with smart fallback defaults.
 * - Use MONGODB_URI env var if set
 * - Local fallback: mongodb://localhost:27017/
 * - Docker Compose fallback: mongodb://mongo:27017/bugsafari
 */
function getDatabaseUri(): string {
  return resolveMongoUri();
}

/**
 * Singleton connection state
 */
let connectionInstance: Promise<typeof mongoose> | null = null;
let isConnected = false;
let connectionError: Error | null = null;

/**
 * Get current connection status.
 */
export function getConnectionState(): { isConnected: boolean; error: Error | null } {
  return { isConnected, error: connectionError };
}

/**
 * Get mongoose instance for model registration.
 * Returns the mongoose module after connection is established.
 */
export function getMongoose(): typeof mongoose {
  return mongoose;
}

/**
 * Connect to MongoDB using singleton pattern.
 * Ensures only one connection exists across the application.
 *
 * @returns Promise<boolean> - true if connected, false if connection failed
 */
export async function connectDatabase(): Promise<boolean> {
  // If already connecting, wait for existing connection promise
  if (connectionInstance !== null) {
    try {
      await connectionInstance;
      return isConnected;
    } catch {
      // Connection failed, reset and allow retry
      connectionInstance = null;
    }
  }

  const uri = getDatabaseUri();
  const options = getMongooseOptions();

  obsLog.info(`[mongooseClient] Connecting to: ${uri.replace(/\/\/.*:.*@/, '//***:***@')}`);
  obsLog.info(`[mongooseClient] NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`);
  obsLog.info(`[mongooseClient] Options: autoIndex=${options.autoIndex}, maxPoolSize=${options.maxPoolSize}`);

  connectionInstance = (async () => {
    try {
      await mongoose.connect(uri, options);

      // Connection event listeners
      mongoose.connection.on('connected', () => {
        isConnected = true;
        connectionError = null;
        obsLog.info(`[mongooseClient]  Connection established (${mongoose.connection.name})`);
      });

      mongoose.connection.on('disconnected', () => {
        isConnected = false;
        obsLog.info(`[mongooseClient]  Connection disconnected`);
      });

      mongoose.connection.on('error', (err) => {
        connectionError = err as Error;
        obsLog.error(`[mongooseClient]  Connection error:`, err);
      });

      mongoose.connection.on('reconnect', () => {
        isConnected = true;
        obsLog.info(`[mongooseClient]  Connection reestablished`);
      });

      return mongoose;
    } catch (err) {
      connectionError = err instanceof Error ? err : new Error(String(err));
      obsLog.error(`[mongooseClient]  Initial connection failed:`, err);
      throw err;
    }
  })();

  try {
    await connectionInstance;
    return true;
  } catch {
    return false;
  }
}

/**
 * Graceful disconnect.
 * Call this on server shutdown.
 */
export async function disconnectDatabase(): Promise<void> {
  if (connectionInstance) {
    try {
      await mongoose.disconnect();
      obsLog.info('[mongooseClient]  Disconnected gracefully');
    } catch (err) {
      obsLog.error('[mongooseClient] Error during disconnect:', err);
    } finally {
      connectionInstance = null;
      isConnected = false;
    }
  }
}

/**
 * Check if database is ready for operations.
 */
export async function ensureConnected(): Promise<boolean> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return true;
  }
  return connectDatabase();
}

/**
 * Check if database connection is ready for requests.
 * Returns true if connected and in ready state.
 */
export function isReady(): boolean {
  // Trust the driver's own readyState (1 = connected) as the source of truth. The
  // `isConnected` flag is set by the 'connected' event listener, which is registered
  // just AFTER mongoose.connect() resolves and therefore misses the very first
  // 'connected' event — leaving isConnected false while the connection is live and
  // making /api/health falsely report mongo:false (503).
  return mongoose.connection.readyState === 1;
}
