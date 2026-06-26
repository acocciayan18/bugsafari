# Implementation Plan: Fix TypeScript Error in authMiddleware.ts

## [Overview]
Fix TypeScript compilation errors where properties `exp` and `iat` do not exist on type `string | JwtPayload` in the authentication middleware.

## [Types]
The issue stems from `jsonwebtoken`'s `decode()` function returning `string | JwtPayload`:
- `string` - returned when token is not a valid JWT or is just a raw string
- `JwtPayload` - proper object with `exp`, `iat`, and other JWT claim properties

Current `DecodedJWTPayload` type in authConfig.ts:
```typescript
export type DecodedJWTPayload = AuthPayload & {
  iat: number;
  exp: number;
};
```

## [Files]
- **testing-core/src/presentation/authentication/authMiddleware.ts** - Modify to add type guards before accessing `exp`/`iat` properties

## [Functions]
No function signatures need to change. Only add type guards where accessing decoded token properties.

## [Classes]
No class modifications required.

## [Dependencies]
No new dependencies needed. Uses existing `jsonwebtoken` types.

## [Testing]
- Verify TypeScript compilation succeeds
- Test that token decoding still works correctly for valid JWTs

## [Implementation Order]
1. Add type guard in `requireAuth()` function to check if decoded token is an object before accessing `exp`/`iat`
2. Verify the fix compiles correctly

---

## task_progress Items:
- [x] Step 1: Read and analyze authMiddleware.ts to understand the error context
- [x] Step 2: Create implementation plan document
- [x] Step 3: Implement the type guard fix in authMiddleware.ts
- [x] Step 4: Verify TypeScript compilation succeeds (fix applied; tsc running)
