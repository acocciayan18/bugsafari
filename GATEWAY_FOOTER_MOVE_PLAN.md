# Implementation Plan - Move GATEWAY Status to Footer

## Overview
Move the "GATEWAY: CONNECTED/DISCONNECTED" status indicator from the header (top-right corner) to the footer, placing it beside the "Testing Core Instance Build" timestamp while maintaining its functionality.

## Types
No type system changes required. Existing TypeScript types are sufficient.

## Files
- **Modify**: `developer-dashboard/src/components/CommandCenter.tsx`
  - Remove Gateway Status Indicator from header (lines ~143-153)
  - Add Gateway Status to footer section beside "Testing Core Instance Build"

## Functions
No function modifications required. Logic stays the same - only UI position changes.

## Classes
No class modifications required.

## Dependencies
No new dependencies required.

## Testing
Manual validation approach:
1. Check that gateway connected status shows in header initially
2. Verify footer displays backend build time
3. After implementation, verify GATEWAY status appears in footer beside build time
4. Test disconnect scenario to ensure "GATEWAY: DISCONNECTED" shows correctly

## Implementation Order

task_progress Items:
- [ ] Step 1: Read CommandCenter.tsx to understand current structure
- [ ] Step 2: Remove Gateway Status from header (lines 143-153)
- [ ] Step 3: Add Gateway Status to footer section
- [ ] Step 4: Test the implementation

---

## Detailed Implementation

### Current Code Structure

**Header Section (to be removed):**
```tsx
{/* Gateway Status Indicator - Top Right Corner */}
{isConnected !== undefined && (
  <div className="absolute top-4 right-4 z-50 flex items-center gap-2 text-xs font-mono">
    {isConnected ? (
      <>
        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-green-600 font-semibold">GATEWAY: CONNECTED</span>
      </>
    ) : (
      <>
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-red-600 font-semibold">GATEWAY: DISCONNECTED</span>
      </>
    )}
  </div>
)}
```

**Footer Section (current):**
```tsx
<div className="border-t border-slate-200 pt-4 flex justify-between items-center">
  <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
    SECURITY PROTOCOL: AES-256 ACTIVE
  </p>
  {backendBuildTime && (
    <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
      ℹ️ Testing Core Instance Build: {backendBuildTime}
    </p>
  )}
</div>
```

**Footer Section (new structure):**
```tsx
<div className="border-t border-slate-200 pt-4 flex justify-between items-center">
  <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
    SECURITY PROTOCOL: AES-256 ACTIVE
  </p>
  <div className="flex items-center gap-4">
    {/* Gateway Status - Now in Footer */}
    {isConnected !== undefined && (
      <div className="flex items-center gap-2 text-xs font-mono">
        {isConnected ? (
          <>
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-green-600 font-semibold">GATEWAY: CONNECTED</span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-red-600 font-semibold">GATEWAY: DISCONNECTED</span>
          </>
        )}
      </div>
    )}
    {/* Backend Build Time */}
    {backendBuildTime && (
      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
        ℹ️ Testing Core Instance Build: {backendBuildTime}
      </p>
    )}
  </div>
</div>
```

### Implementation Notes
- The `isConnected` prop is already passed to CommandCenter from the parent component
- The footer already has a flex layout with `justify-between`, so we can add the gateway status inline
- We will add a wrapper div around the right side elements to group them together
- Keep existing styling for consistency
