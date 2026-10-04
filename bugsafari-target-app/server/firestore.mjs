// Firestore data layer for the NoSQL-injection scenario. Lazy init from service-account
// env; falls back to in-memory test data when no credentials are present yet.

const TEST_USERS = [
  { username: 'alice', role: 'user' },
  { username: 'bob', role: 'user' },
  { username: 'admin', role: 'admin' },
];

let store = null;

function hasServiceAccount() {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

async function initStore() {
  if (store) return store;
  if (!hasServiceAccount()) { store = { live: false }; return store; }
  try {
    const { cert, getApps, initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }
    store = { live: true, db: getFirestore(), collection: process.env.FIREBASE_TEST_COLLECTION || 'bugsafari_test_users' };
  } catch {
    // firebase-admin missing or init failed — stay on mock so the scenario still runs
    store = { live: false };
  }
  return store;
}

export async function storeLabel() {
  return (await initStore()).live ? 'firestore' : 'mock';
}

// Benign equality lookup only; operator payloads are handled by the route before this runs.
export async function lookupUser(username) {
  const s = await initStore();
  if (!s.live) return TEST_USERS.find((u) => u.username === username) ?? null;
  const snap = await s.db.collection(s.collection).where('username', '==', username).limit(1).get();
  return snap.empty ? null : { username, ...snap.docs[0].data() };
}
