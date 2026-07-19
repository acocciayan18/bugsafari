// One-shot migration: console_logs.timestamp and network_logs.timestamp were
// stored as ISO strings; the schemas now declare them as Date. Strict queries on
// a Date path do not match string data, so run this BEFORE deploying the schema
// change (it is safe to re-run afterwards).
//
// Idempotent and self-terminating: the { $type: 'string' } filter shrinks to an
// empty set once every row is converted. Unparseable values fall back to createdAt.
// Run: npx tsx scripts/migrate-log-timestamps.ts   (npm run db:migrate:log-timestamps)

import type { AnyBulkWriteOperation, Collection, Document } from 'mongodb';
import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database/mongooseClient.js';
import { ConsoleLogModel } from '../src/infrastructure/database/models/ConsoleLogModel.js';
import { NetworkLogModel } from '../src/infrastructure/database/models/NetworkLogModel.js';

const BATCH_SIZE = 1000;

async function migrateCollection(collection: Collection<Document>): Promise<number> {
  let migrated = 0;
  let unparseable = 0;

  for (;;) {
    const batch = await collection.find({ timestamp: { $type: 'string' } }).limit(BATCH_SIZE).toArray();
    if (!batch.length) break;

    const operations: AnyBulkWriteOperation<Document>[] = batch.map((doc) => {
      const raw = doc.timestamp as string;
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed)) unparseable += 1;
      const value = Number.isNaN(parsed) ? (doc.createdAt as Date | undefined) ?? new Date(0) : new Date(parsed);
      return { updateOne: { filter: { _id: doc._id }, update: { $set: { timestamp: value } } } };
    });

    await collection.bulkWrite(operations, { ordered: false });
    migrated += batch.length;
    console.log(`[migrate] ${collection.collectionName}: ${migrated} converted`);
  }

  if (unparseable > 0) {
    console.warn(`[migrate] ${collection.collectionName}: ${unparseable} unparseable value(s) fell back to createdAt.`);
  }
  return migrated;
}

async function main(): Promise<void> {
  const connected = await connectDatabase();
  if (!connected) {
    console.error('[migrate] Database connection failed — nothing migrated.');
    process.exitCode = 1;
    return;
  }

  let total = 0;
  for (const model of [ConsoleLogModel, NetworkLogModel]) {
    total += await migrateCollection(model.collection as never);
  }

  await disconnectDatabase();
  console.log(`[migrate] Done. ${total} document(s) converted to Date.`);
}

await main();
