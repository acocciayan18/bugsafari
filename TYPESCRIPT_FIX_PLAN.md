# TypeScript Fix Plan - registerRoutes.ts

## Executive Summary

This document outlines the TypeScript type mismatches found in `testing-core/src/presentation/api/registerRoutes.ts` and the fixes applied to resolve them.

---

## Errors Found

### 1. Express Parameter Type Mismatch (string | string[])

**Problem:** Express can return `string | string[]` for `req.query`, `req.params`, or `req.headers` when multiple values exist, but database methods expect strict `string` or `ObjectId` types.

**Affected Lines:**
- Line ~222: `/api/history/sessions` - `request.query.limit`
- Line ~483: `/api/history/:id` DELETE - `request.params.id`
- Line ~503: `/api/history/export/:id` - `request.params.id`
- Line ~515: `/api/forensic/screenshots` - `request.query.sessionId`
- Line ~537: `/api/forensic/analysis` - `request.query.sessionId`

**Error Message:**
```
Type 'string | string[]' is not assignable to type 'string'
```

### 2. Missing Mongoose Document Methods

**Problem:** Some routes were trying to assign plain JavaScript objects to types expecting full Mongoose Documents (ISavedSafari), resulting in missing methods like `$assertPopulated`, `$clone`, etc.

**Affected Lines:**
- Line ~458: `/api/history` - Return type from `savedSafariRepository.getSafariHistoryByUserId()`

**Error Message:**
```
Property '$assertPopulated' is missing in type 'Partial<ISavedSafari>'
```

---

## Fixes Applied

### Fix 1: Safe Parameter Extraction Utilities

Added two utility functions at the top of the file to safely handle Express parameters:

```typescript
/**
 * Safely extract a single string from Express params/query.
 * Express can return string|ParsedQs|string[] when multiple values exist.
 */
function extractStringParam(value: string | ParsedQs | (string | ParsedQs)[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Safely extract and validate ObjectId from string parameter.
 * Returns null if invalid.
 */
function extractObjectIdParam(value: string | ParsedQs | (string | ParsedQs)[] | undefined): string | null {
  const str = extractStringParam(value);
  if (!str) return null;
  if (!/^[0-9a-fA-F]{24}$/.test(str)) {
    return null;
  }
  return str;
}
```

### Fix 2: Updated Route Handlers

#### `/api/history/sessions` (GET)
- **Before:** `const rawLimit = Number(request.query.limit ?? 50);`
- **After:** 
```typescript
const rawLimit = extractStringParam(request.query.limit);
const limitVal = rawLimit ? Number(rawLimit) : 50;
const limit = Number.isFinite(limitVal) ? Math.max(1, Math.min(limitVal, 200)) : 50;
```

#### `/api/history/:id` (DELETE)
- **Before:** `const recordId = request.params.id;`
- **After:** `const recordId = extractObjectIdParam(request.params.id);`

#### `/api/history/export/:id` (GET)
- **Before:** `const recordId = request.params.id;`
- **After:** `const recordId = extractObjectIdParam(request.params.id);`

#### `/api/forensic/screenshots` (GET)
- **Before:** `const sessionId = request.query.sessionId as string | undefined;`
- **After:** `const sessionId = extractStringParam(request.query.sessionId) || undefined;`

#### `/api/forensic/analysis` (GET)
- **Before:** `const sessionId = request.query.sessionId as string | undefined;`
- **After:** `const sessionId = extractStringParam(request.query.sessionId) || undefined;`

### Fix 3: Mongoose Document Return Type

The `SavedSafariRepository.getSafariHistoryByUserId()` method already uses `.lean<ISavedSafari[]>()` to return plain JS objects. No changes needed here - the fix was already in place in the repository.

---

## Code Changes Summary

| Route | Parameter | Before | After |
|-------|-----------|--------|-------|
| GET /api/history/sessions | limit | `request.query.limit` | `extractStringParam(request.query.limit)` |
| DELETE /api/history/:id | id | `request.params.id` | `extractObjectIdParam(request.params.id)` |
| GET /api/history/export/:id | id | `request.params.id` | `extractObjectIdParam(request.params.id)` |
| GET /api/forensic/screenshots | sessionId | `request.query.sessionId as string` | `extractStringParam(request.query.sessionId)` |
| GET /api/forensic/analysis | sessionId | `request.query.sessionId as string` | `extractStringParam(request.query.sessionId)` |

---

## Validation

After applying these fixes:
1. TypeScript should compile without errors
2. Express parameters are safely extracted as single strings
3. ObjectId validation ensures only valid 24-character hex strings are passed to the database
4. The Mongoose Document types are properly handled via `.lean()` in the repository

---

## Future Recommendations

1. **Add Express Request Generic Types:** Consider typing the Express Request with generic parameters in the route definitions to eliminate the need for manual type casting:
   ```typescript
   app.get('/api/history/:id', (req: Request<{id: string}>, res: Response) => {...})
   ```

2. **Centralized Error Handling:** Create a middleware that validates and parses all route parameters uniformly.

3. **Test Coverage:** Add unit tests for the parameter extraction utilities to ensure edge cases are handled.

---

*Generated: 2024*
*File:* `testing-core/src/presentation/api/registerRoutes.ts`
