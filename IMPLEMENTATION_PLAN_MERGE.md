# Implementation Plan

[Overview]

Consolidate the InteractiveElement type re-export in domParser.ts to provide a single import path for consumers, while keeping the type definition file for backward compatibility. This simplifies the import pattern across the codebase without losing the separation of concerns.

[Types]

**Current Type Structure:**
- `InteractiveElement` interface in `testing-core/src/domain/entities/InteractiveElement.ts`
- `ParsedElement` interface in `testing-core/src/domain/heuristics/domParser.ts` (internal use)

**Proposed Changes:**
- Add re-export of `InteractiveElement` in `domParser.ts` for convenience
- Add `ParsedElement` as alias or internal documentation
- Keep both files to maintain backward compatibility

[Files]

**No New Files Required**

**Existing Files to Modify:**
- `testing-core/src/domain/heuristics/domParser.ts` - Add re-export statement

**Files Unchanged:**
- `testing-core/src/domain/entities/InteractiveElement.ts` - Keep as source of truth
- All consuming files can continue using existing import paths

[Functions]

**No Function Changes Required**
- `scanInteractiveElements()` - Unchanged
- `RecursiveDomParser.parse()` - Unchanged

[Classes]

**No Class Changes Required**
- `RecursiveDomParser` - Unchanged

[Dependencies]

**No New Dependencies Required**

**Import Changes:**
- Add re-export: `export type { InteractiveElement } from './entities/InteractiveElement.js';`
- Or: Export from index.ts barrel file in domain/entities/

[Testing]

**Test File Requirements:**
- No new tests required
- Existing tests should continue to work

**Existing Test Modifications:**
- None required if backward compatibility maintained

[Implementation Order]

1. Confirm the understanding with user - should we proceed with re-export approach?
2. Modify `domParser.ts` to re-export `InteractiveElement` type
3. Or: Verify if this is the desired approach or if they want something else

---

## Decision Required: What type of "merge" is intended?

### Option A: Re-export in domParser.ts (RECOMMENDED)
Add re-export statement in domParser.ts so consumers can import from single source:
```typescript
export type { InteractiveElement } from './entities/InteractiveElement.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
```

### Option B: Merge into entities/ folder
Move all types to a single location (entities/index.ts barrel file)

### Option C: Full merge (NOT RECOMMENDED)
Combine both files into one - loses separation of concerns

### Option D: Leave as-is
Keep current structure - works fine, no changes needed

---

## Verification Checklist

- [x] InteractiveElement.ts contains only type definition
- [x] domParser.ts imports and uses InteractiveElement
- [x] Multiple consumers use both files
- [x] Both files are in active use
- [x] No circular dependencies
- [x] Clear separation of concerns maintained
