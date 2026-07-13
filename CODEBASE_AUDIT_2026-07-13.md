# Codebase Audit — 2026-07-13

Branch: `7-13-Ayan-3` vs `main`

## 1. Diff vs main

`codemap.exe` is blocked by a Windows Application Control (AppLocker/WDAC) policy on this machine, so `git diff` was used instead.

583 files changed, +59,915/−452,408 lines — but the deletion count is misleading: `main` has `testing-core/node_modules/typescript/*` committed to git (200K+ line generated files), and this branch removes them from tracking. That accounts for ~410K of the 452K deletions and is a legitimate cleanup, not code churn.

Real source changes span:
- Exploration engine: `domHasher.ts`, `perceptron.ts`, `circularBuffer.ts`
- Full auth restructure: `presentation/api/authController.ts` split into `presentation/authentication/*` (login, signup, password reset, settings, validation, config)
- `registerRoutes.ts`, `SafariWorker.ts`

## 2. Type safety

428 uses of `any` (`: any`, `as any`, `<any>`) across `testing-core/` + `shared/`.

## 3. Unhandled errors

- 363 `try` blocks
- 60 `.catch()` calls

in `testing-core/`.

## 4. Algorithm hotspots

62 real source files match hash/Delta/circular/buffer. Core ones:
- `testing-core/src/ml/domHasher.ts`
- `testing-core/src/ml/perceptron.ts`
- `testing-core/src/lib/circularBuffer.ts`
- `testing-core/src/domain/services/exploration/StateClusterRegistry.ts`
- `testing-core/src/domain/services/pathfinder/*`

## 5. Recent commits

```
32297fc fix some frntend prob
1bde512 fix some frntend prob
971e32e improved exploration
990fbaf improve some functionalities but still to improve, foxus only in dashboard part
a36c0a0 file after adding a popup testing
db9d33f files before adding a popup test ability
7a1a6cf improve the reproducability
1f3d3b9 improve that error really comes from teh website
cfd22fa improve testing with fable
f3766ac remove the route trasher
```

## 6. Uncommitted work

Clean — nothing pending.

## 7. Debug artifacts

The original audit script's `grep -v test` filter was broken: every path under `testing-core/` contains "test" as a substring, so it silently discarded all matches and reported 0. Correct count: **475 `console.*` calls** in `testing-core/src`.
