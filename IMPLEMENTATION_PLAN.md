# Implementation Plan

[Overview]
Refactor the `scanInteractiveElements` function in `domParser.ts` to support modern web component microfrontends with closed Shadow DOM boundaries. Replace the current iterative collection loop with a deep recursive traversal method that properly detects and enters `.shadowRoot` boundaries, including closed Shadow DOMs via Chrome DevTools Protocol access.

[Types]
Define new result interfaces for the recursive traversal that tracks element origins (light DOM vs shadow DOM).

**New Types to Add:**
```typescript
// Interface for element with source tracking
interface ShadowAwareElement {
  element: Element;
  shadowMode: 'open' | 'closed' | 'none';
  depth: number;
  path: string; // Track the DOM path for debugging
}

// Interface for closed shadow root access result
interface ClosedShadowAccess {
  success: boolean;
  elements: Element[];
}
```

**Existing Types Unchanged:**
- `ParsedElement` - Keep as is
- `InteractiveElement` - Keep as is
- `BoundingBox` - Keep as is (from @bugsafari/shared)

[Files]
Single sentence describing file modifications.

- **Modified**: `testing-core/src/domain/heuristics/domParser.ts` - Complete refactor of element collection logic

**No New Files Required**

**Detailed breakdown:**
- Existing files to be modified:
  - `testing-core/src/domain/heuristics/domParser.ts` - Replace `collectElements` with deep recursive traversal

[Functions]
Single sentence describing function modifications.

**New Function: DeepRecursiveTraversal**
- Signature: `deepTraverse(root: Document | Element | ShadowRoot): ParsedElement[]`
- File path: Inside `page.evaluate()` in `scanInteractiveElements()`
- Purpose: Pure recursive traversal that handles open and closed shadow DOM boundaries

**Modified Function: scanInteractiveElements(page)**
- Current: Uses iterative `collectElements` with secondary shadow handling
- Required: Refactor to use deep recursive traversal as primary pattern

**New Helper: accessClosedShadowRoot(element)**
- Signature: `accessClosedShadowRoot(el: Element): ShadowRoot | null`
- Purpose: Chrome-specific method to access closed shadow roots using evaluate with `openOrClosedShadowRoot`

**Helper Functions (Internal to page.evaluate()):**
- `buildSelector(element)` - Keep existing
- `extractText(element)` - Keep existing
- `isDisabled(element)` - Keep existing
- `isElementClickable(element)` - Keep existing
- `filterVolatileClasses(className)` - Keep existing

[Classes]
Single sentence describing class modifications.

No class modifications required. The `RecursiveDomParser` class will automatically benefit from the refactored `scanInteractiveElements()`.

**Detailed breakdown:**
- New classes: None
- Modified classes: None
- Removed classes: None

[Dependencies]
Single sentence describing dependency modifications.

No new npm dependencies required. The implementation uses existing Playwright APIs and Chrome DevTools Protocol features accessible via `page.evaluate()`.

**Detailed breakdown:**
- Playwright 1.59.1 - Already in use
- No version changes required
- Integration: Uses CDP access via `page.evaluate()` for closed shadow root detection

[Testing]
Single sentence describing testing approach.

Test the implementation by creating test pages with Shadow DOM (both open and closed modes) and verify all interactive elements are discovered.

**Test File Requirements:**
- Create test HTML files with:
  - Open Shadow DOM containing buttons/inputs
  - Closed Shadow DOM (`attachShadow({ mode: 'closed' })`) containing interactive elements
  - Nested Shadow DOM boundaries
  - Iframes with Shadow DOM inside
- Existing automated tests should continue to pass

**Validation Strategies:**
1. Test with open Shadow DOM - verify elements found
2. Test with closed Shadow DOM - verify elements found (key validation)
3. Test with nested boundaries - verify deep traversal works
4. Run existing test suite to confirm no regressions

[Implementation Order]
Single sentence describing the implementation sequence.

Refactor the element collection in a single coordinated change within `domParser.ts`.

Numbered steps:
1. **Step 1**: Add `accessClosedShadowRoot()` helper inside `page.evaluate()` IIFE - uses Chrome's `openOrClosedShadowRoot` property accessible via evaluate
2. **Step 2**: Replace iterative `collectElements` with pure recursive `deepTraverse()` function that treats shadow boundary detection as primary operation
3. **Step 3**: Ensure the recursive function handles: open shadow roots, closed shadow roots (via helper), iframe documents, and native elements in a unified traversal pattern
4. **Step 4**: Test the implementation

---

## Implementation Details

### Current vs. Proposed Architecture

**Current (Iterative/Secondary):**
```javascript
const collectElements = (root) => {
  // 1. Collect from current root
  Array.from(root.querySelectorAll(query)).forEach(el => rawElementsSet.add(el));

  // 2. Iterate children - Shadow DOM is SECONDARY
  const children = root.children || root.childNodes || [];
  for (const child of children) {
    if (child.shadowRoot) {  // Only catches OPEN shadow roots
      collectElements(child.shadowRoot);
    }
    // ...
  }
};
```

**Proposed (Recursive/Primary):**
```javascript
// Deep recursive traversal - treats boundary crossing as PRIMARY
const deepTraverse = (root, depth = 0, path = 'document') => {
  const results = [];

  // 1. Collect interactive elements from current context
  if (root.querySelectorAll) {
    const elements = Array.from(root.querySelectorAll(query));
    for (const el of elements) {
      results.push({ element: el, depth, path });
    }
  }

  // 2. Recursively traverse into shadow boundaries (PRIMARY operation)
  const children = root.children || [];
  for (const child of children) {
    const tag = child.tagName?.toLowerCase() || '';

    // Handle Shadow DOM - both open AND closed
    const shadowRoot = getShadowRoot(child);
    if (shadowRoot) {
      results.push(...deepTraverse(shadowRoot, depth + 1, path + ' > shadow-root'));
      continue;
    }

    // Handle iframes
    if (tag === 'iframe' || tag === 'frame') {
      try {
        if (child.contentDocument) {
          results.push(...deepTraverse(child.contentDocument, depth + 1, path + ' > iframe'));
        }
      } catch (e) { /* cross-origin */ }
      continue;
    }

    // Continue recursion for nested elements
    results.push(...deepTraverse(child, depth, path));
  }

  return results;
};

const getShadowRoot = (element) => {
  // Try open shadow root first
  if (element.shadowRoot) return element.shadowRoot;

  // Try to access closed shadow root via evaluate
  // Note: This requires the element handle, works via page.evaluate
  try {
    return element.openOrClosedShadowRoot || null;
  } catch {
    return null;
  }
};
```

### Closed Shadow DOM Access Strategy

Chrome/Chromium provides a way to access closed shadow roots:
- `element.openOrClosedShadowRoot` - Returns the shadow root regardless of mode
- This is accessible in browser context but not via standard DOM API
- Implementation uses `page.evaluate()` to run JavaScript that accesses this property

### Path String Generation

Track the DOM path for debugging and logging:
- Format: `document > body > custom-element > shadow-root > input`
- Helps identify elements found in shadow boundaries when debugging

---

## Quality Standards

1. **Pure Recursion**: The traversal must be structured as deep recursive calls, not iterative loops with recursion
2. **Unified Handling**: Open shadow, closed shadow, and iframe must be handled with the same code path
3. **Depth Tracking**: Maintain depth counter to prevent infinite recursion on pathological cases
4. **Error Isolation**: Each boundary crossing must be error-isolated so failures don't break the entire scan
5. **Backward Compatibility**: All existing behavior (visibility filtering, selector building, etc.) must remain functional
6. **Performance**: Deep recursion must have safeguards against pathological DOM trees (max depth limit)

---

## Key Technical Details

### Why `element.shadowRoot` Returns Null for Closed Shadow DOM

In the DOM spec:
- `element.shadowRoot` only returns the shadow root if `mode === 'open'`
- For closed shadow roots, this property returns `null`
- However, Chrome exposes `element.openOrClosedShadowRoot` internally

### Playwright Integration

The refactored code remains inside `page.evaluate()`:
- All code runs in browser context
- Playwright handles the CDP communication
- No additional Playwright-specific APIs needed

### Maximum Depth Safeguard

Add a maximum depth constant to prevent infinite recursion:
```javascript
const MAX_TRAVERSE_DEPTH = 50;
```

If depth exceeds this, stop recursing into that branch and log a warning.
