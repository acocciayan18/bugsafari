import { lookupUser, storeLabel } from '../firestore.mjs';

// Mirrors the detectable branching the SIGNAL + DIFFERENTIAL oracles confirm on (CWE-943).
const MONGO_ERROR = 'MongoError: unknown operator: $where in query';
const BYPASS_OPS = new Set(['$ne', '$gt', '$gte', '$lt', '$lte', '$regex', '$in']);

export function registerInjectionFirestore(app) {
  app.post('/api/login-nosql-firestore', async (req, res) => {
    const u = req.body?.username;
    // operator object reaches the query layer unsanitized
    if (u && typeof u === 'object' && !Array.isArray(u)) {
      const keys = Object.keys(u);
      if (keys.includes('$where')) return res.status(500).json({ error: MONGO_ERROR });
      if (keys.some((k) => BYPASS_OPS.has(k))) {
        return res.status(200).json({ authenticated: true, source: await storeLabel(), users: ['alice', 'bob', 'admin'] });
      }
      if (keys.some((k) => k.startsWith('$'))) return res.status(500).json({ error: MONGO_ERROR });
    }
    // benign string hits the real datastore (mock test data when no credentials)
    const username = String(u ?? '');
    const found = await lookupUser(username).catch(() => null);
    return res.status(401).json({ error: 'invalid credentials', matched: Boolean(found) });
  });
}
