/**
 * Mongoose Database Client - Singleton Connection Manager
 * Provides centralized database connection with production cloud optimizations.
 */

import mongoose from 'mongoose';
import type { ConnectOptions } from 'mongoose';

const isLocal = (uri: string): boolean => uri.includes('localhost') || uri.includes('127.0.0.1');

/**
 * Get optimized mongoose connection options based on environment.
 */
function getMongooseOptions(): ConnectOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/';
  const isLocalEnv = isLocal(uri);

  const options: ConnectOptions = {
    // Explicitly force the database name to prevent falling back to system databases
    dbName: 'bugsafari',

    // Connection pool size - bounded for free-tier databases
    maxPoolSize: 10,

    // Server selection timeout - automatic reconnection
    serverSelectionTimeoutMS: 5000,

    // Socket configuration for network stability
    socketTimeoutMS: 45000,
    // Buffer commands during connection drops
    bufferCommands: true,

// Production: Disable auto-indexing to prevent performance blocks on Atlas
    // Local development: Keep enabled for convenience
    ...(isProduction ? { autoIndex: false } : { autoIndex: true }),

    // Force disable all compression to avoid MongoMissingDependencyError
    // The @mongodb-js/zstd optional module may not be installed
    compressors: [],
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
  return (
    process.env.MONGODB_URI ??
    process.env.MONGO_URI ??
    'mongodb://localhost:27017/'
  );
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

  console.log(`[mongooseClient] Connecting to: ${uri.replace(/\/\/.*:.*@/, '//***:***@')}`);
  console.log(`[mongooseClient] NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[mongooseClient] Options: autoIndex=${options.autoIndex}, maxPoolSize=${options.maxPoolSize}`);

  connectionInstance = (async () => {
    try {
      await mongoose.connect(uri, options);

      // Connection event listeners
      mongoose.connection.on('connected', () => {
        isConnected = true;
        connectionError = null;
        console.log(`[mongooseClient] 🟢 Connection established (${mongoose.connection.name})`);
      });

      mongoose.connection.on('disconnected', () => {
        isConnected = false;
        console.log(`[mongooseClient] 🔴 Connection disconnected`);
      });

      mongoose.connection.on('error', (err) => {
        connectionError = err as Error;
        console.error(`[mongooseClient] ❌ Connection error:`, err);
      });

      mongoose.connection.on('reconnect', () => {
        isConnected = true;
        console.log(`[mongooseClient] 🔄 Connection reestablished`);
      });

      return mongoose;
    } catch (err) {
      connectionError = err instanceof Error ? err : new Error(String(err));
      console.error(`[mongooseClient] 🟡 Initial connection failed:`, err);
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
      console.log('[mongooseClient] 🔌 Disconnected gracefully');
    } catch (err) {
      console.error('[mongooseClient] Error during disconnect:', err);
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
  return isConnected && mongoose.connection.readyState === 1;
}
