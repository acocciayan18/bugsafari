// Guards the Target URL input's persistence: the operator's entry must survive a stop,
// page reload, route navigation, and session recovery, and must never leak into (or be
// clobbered by) the Live Feed browser URL. Run via `npm test`; exits non-zero on the
// first failed node:assert.

import assert from 'node:assert/strict';
import { readTargetUrlDraft, writeTargetUrlDraft, DEFAULT_TARGET_URL } from './targetUrlDraft.js';

// Minimal in-memory localStorage stand-in — no jsdom, matching the zero-dep runner. The
// module reads storage lazily on every call, so swapping the global between cases is all
// that's needed; there is no module-level state to reset.
function makeStorage(): Storage {
    const map = new Map<string, string>();
    return {
        getItem: (k) => (map.has(k) ? map.get(k)! : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => map.clear(),
        key: (i) => Array.from(map.keys())[i] ?? null,
        get length() { return map.size; },
    } as Storage;
}

// A storage whose access throws — private mode / disabled cookies.
const throwingStorage = new Proxy({} as Storage, {
    get() { throw new Error('storage unavailable'); },
});

function installStorage(storage: Storage | undefined): void {
    (globalThis as { window?: { localStorage?: Storage } }).window =
        storage ? { localStorage: storage } : undefined;
}

// Default when nothing was ever stored.
installStorage(makeStorage());
assert.equal(readTargetUrlDraft(), DEFAULT_TARGET_URL, 'empty storage returns the default');

// A written value is read back verbatim — the persist path.
{
    installStorage(makeStorage());
    writeTargetUrlDraft('https://shop.example.test/checkout');
    assert.equal(readTargetUrlDraft(), 'https://shop.example.test/checkout', 'persisted value reads back verbatim');
}

// Simulated reload: the same backing storage, re-installed, still yields the value. This
// is the reported bug — a page restart must not fall back to the default.
{
    const storage = makeStorage();
    installStorage(storage);
    writeTargetUrlDraft('https://app.example.test/login');
    installStorage(storage);
    assert.equal(readTargetUrlDraft(), 'https://app.example.test/login', 'value persists across a page reload');
}

// An explicit clear (blank field) drops the key, so the next load shows the default.
{
    installStorage(makeStorage());
    writeTargetUrlDraft('https://app.example.test/');
    writeTargetUrlDraft('');
    assert.equal(readTargetUrlDraft(), DEFAULT_TARGET_URL, 'clearing the field falls back to the default');
}

// Whitespace-only input is treated as blank on write.
{
    installStorage(makeStorage());
    writeTargetUrlDraft('   ');
    assert.equal(readTargetUrlDraft(), DEFAULT_TARGET_URL, 'whitespace-only is not a real target');
}

// A blank value already sitting in storage (legacy/corrupt) still resolves to the default.
{
    const storage = makeStorage();
    storage.setItem('bugsafari.targetUrlDraft', '   ');
    installStorage(storage);
    assert.equal(readTargetUrlDraft(), DEFAULT_TARGET_URL, 'a blank stored value falls back to the default');
}

// Read is resilient when storage access throws.
{
    installStorage(throwingStorage);
    assert.equal(readTargetUrlDraft(), DEFAULT_TARGET_URL, 'unreadable storage returns the default, never throws');
}

// Write never throws when storage is unavailable.
{
    installStorage(throwingStorage);
    assert.doesNotThrow(() => writeTargetUrlDraft('https://app.example.test/'), 'write swallows storage errors');
}

// No `window` at all (SSR-like) is safe for both read and write.
{
    installStorage(undefined);
    assert.equal(readTargetUrlDraft(), DEFAULT_TARGET_URL, 'no window returns the default');
    assert.doesNotThrow(() => writeTargetUrlDraft('https://app.example.test/'), 'no window is safe to write');
}

// The draft key is independent of any Live Feed / currentUrl storage — writing the target
// never touches another key, so the two URLs can never cross-contaminate.
{
    const storage = makeStorage();
    storage.setItem('bugsafari.currentUrl', 'https://app.example.test/live/page-7');
    installStorage(storage);
    writeTargetUrlDraft('https://app.example.test/');
    assert.equal(storage.getItem('bugsafari.currentUrl'), 'https://app.example.test/live/page-7', 'target draft leaves the live URL untouched');
}

console.log('✓ targetUrlDraft: all persistence invariants hold');
