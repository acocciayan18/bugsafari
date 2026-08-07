import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGODB_URI ?? process.env.MONGO_URI);
const db = mongoose.connection.db;
const doc = await db.collection('sessions').findOne({ runId: 'RUN-6D924C' });
if (!doc) { console.log('not found'); } else {
  for (const b of (doc.forensicTrace?.caughtBugs ?? [])) {
    const steps = Array.isArray(b.actionSteps) ? b.actionSteps.length : 0;
    const narr = Array.isArray(b.reproductionSteps) ? b.reproductionSteps.length : 0;
    console.log(`${(b.attribution?.bugClass ?? b.type).padEnd(30)} actionSteps=${String(steps).padStart(2)} narrative=${narr}`);
  }
}
await mongoose.disconnect();
