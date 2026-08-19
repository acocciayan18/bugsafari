// Guards the pre-launch config persistence: Duration, Navigation boundary, and the
// Target Auth STRUCTURE must survive test runs, reloads, and restarts, while the auth
// password must never reach storage. Run via `npm test`; exits non-zero on first fail.

import assert from 'node:assert/strict';
import { readLaunchConfigDraft, writeLaunchConfigDraft } from './launchConfigDraft.js';

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

const throwingStorage = new Proxy({} as Storage, {
    get() { throw new Error('storage unavailable'); },
});

function installStorage(storage: Storage | undefined): void {
    (globalThis as { window?: { localStorage?: Storage } }).window =
        storage ? { localStorage: storage } : undefined;
}

const sampleAuth = {
    enabled: true,
    username: 'tester@example.test',
    password: 'super-secret',
    loginUrl: 'https://app.example.test/login',
    usernameSelector: '#email',
    passwordSelector: '#password',
    submitSelector: 'button[type=submit]',
    successIndicator: '[data-testid=dashboard]',
};

// First run: nothing stored yields the sensible defaults.
{
    installStorage(makeStorage());
    const cfg = readLaunchConfigDraft();
    assert.equal(cfg.duration, '10m', 'default duration');
    assert.equal(cfg.boundaryMode, 'site', 'default boundary');
    assert.equal(cfg.auth.enabled, false, 'default auth off');
    assert.ok(cfg.profile.length > 0, 'default profile present');
}

// Profile + Duration + Navigation persist and read back verbatim.
{
    installStorage(makeStorage());
    writeLaunchConfigDraft({ profile: 'DEEP_SEMANTIC_DATA_ATTACK', duration: '30m', boundaryMode: 'exact', auth: sampleAuth });
    const cfg = readLaunchConfigDraft();
    assert.equal(cfg.duration, '30m', 'duration persists');
    assert.equal(cfg.boundaryMode, 'exact', 'boundary persists');
    assert.equal(cfg.profile, 'DEEP_SEMANTIC_DATA_ATTACK', 'profile persists');
}

// The password is stripped on write and never restored.
{
    const storage = makeStorage();
    installStorage(storage);
    writeLaunchConfigDraft({ profile: 'CHAOS_INFILTRATION', duration: '5m', boundaryMode: 'subtree', auth: sampleAuth });
    assert.ok(!storage.getItem('bugsafari.launchConfigDraft')!.includes('super-secret'), 'password not serialized');
    const cfg = readLaunchConfigDraft();
    assert.equal(cfg.auth.password, '', 'password restored empty');
    assert.equal(cfg.auth.username, 'tester@example.test', 'username persists');
    assert.equal(cfg.auth.usernameSelector, '#email', 'selectors persist');
    assert.equal(cfg.auth.enabled, true, 'enabled persists');
}

// Simulated reload: same backing storage re-installed still yields the choices.
{
    const storage = makeStorage();
    installStorage(storage);
    writeLaunchConfigDraft({ profile: 'CHAOS_INFILTRATION', duration: '20m', boundaryMode: 'exact', auth: sampleAuth });
    installStorage(storage);
    assert.equal(readLaunchConfigDraft().duration, '20m', 'persists across reload');
}

// Malformed ids fall back to defaults; corrupt JSON is safe.
{
    const storage = makeStorage();
    storage.setItem('bugsafari.launchConfigDraft', JSON.stringify({ profile: 'nope', duration: 'nope', boundaryMode: 'bad', auth: 5 }));
    installStorage(storage);
    const cfg = readLaunchConfigDraft();
    assert.equal(cfg.duration, '10m', 'invalid duration falls back');
    assert.equal(cfg.boundaryMode, 'site', 'invalid boundary falls back');
    assert.equal(cfg.profile, 'CHAOS_INFILTRATION', 'invalid profile falls back');
    assert.equal(cfg.auth.enabled, false, 'invalid auth falls back');

    storage.setItem('bugsafari.launchConfigDraft', '{not json');
    installStorage(storage);
    assert.equal(readLaunchConfigDraft().duration, '10m', 'corrupt JSON falls back');
}

// Storage errors and SSR-like no-window are non-fatal for both read and write.
{
    installStorage(throwingStorage);
    assert.equal(readLaunchConfigDraft().duration, '10m', 'unreadable storage returns default');
    assert.doesNotThrow(() => writeLaunchConfigDraft({ profile: 'CHAOS_INFILTRATION', duration: '5m', boundaryMode: 'site', auth: sampleAuth }), 'write swallows errors');

    installStorage(undefined);
    assert.equal(readLaunchConfigDraft().boundaryMode, 'site', 'no window returns default');
    assert.doesNotThrow(() => writeLaunchConfigDraft({ profile: 'CHAOS_INFILTRATION', duration: '5m', boundaryMode: 'site', auth: sampleAuth }), 'no window is safe to write');
}

console.log('✓ launchConfigDraft: persistence + password-safety invariants hold');
