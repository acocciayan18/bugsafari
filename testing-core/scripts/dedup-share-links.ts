// One-shot cleanup for links minted before create-or-reuse. Keeps the newest active
// (unrevoked, unexpired) link per (userId, sessionId, expiresIn) and revokes the rest
// so the partial-unique index can build. Idempotent; safe to re-run.
// Run: npx tsx scripts/dedup-share-links.ts   (npm run db:dedup:share-links)

import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database/mongooseClient.js';
import { ShareLinkModel } from '../src/infrastructure/database/models/ShareLinkModel.js';

async function main(): Promise<void> {
  const connected = await connectDatabase();
  if (!connected) {
    console.error('[dedup-share-links] Database connection failed — nothing changed.');
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const groups = await ShareLinkModel.aggregate<{ _id: unknown; keep: unknown; extra: unknown[] }>([
    { $match: { revokedAt: null, expiresAt: { $gt: now } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { userId: '$userId', sessionId: '$sessionId', expiresIn: '$expiresIn' }, keep: { $first: '$_id' }, extra: { $push: '$_id' } } },
    { $project: { keep: 1, extra: { $slice: ['$extra', 1, 1_000_000] } } },
    { $match: { 'extra.0': { $exists: true } } },
  ]);

  const stale = groups.flatMap((g) => g.extra);
  if (stale.length === 0) {
    console.log('[dedup-share-links] No duplicate active links found.');
  } else {
    const res = await ShareLinkModel.updateMany({ _id: { $in: stale } }, { $set: { revokedAt: now } });
    console.log(`[dedup-share-links] Revoked ${res.modifiedCount} duplicate active link(s) across ${groups.length} group(s).`);
  }

  await disconnectDatabase();
}

await main();
