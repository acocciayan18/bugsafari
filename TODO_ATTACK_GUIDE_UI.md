# TODO: Attack Guide UI Upgrade

## Task Summary
Transform the ReproducibleSteps timeline into an "Attack Execution Summary" that groups sequential identical steps into phases and filters deduplicate findings.

## Files to Modify

### 1. developer-dashboard/src/utils/semanticFormatter.ts
**Current State**: Already has descriptive attack patterns with title property
**Status**: COMPLETED - No changes needed

### 2. developer-dashboard/src/components/ReproducibleSteps.tsx
**Current State**: Renders individual steps and findings with basic deduplication
**Target State**: Grouped phases, Vite filter, enhanced deduplication

**New Changes Required**:

#### A. Phase Grouping for Steps (NEW REQUIREMENT)
Instead of 1:1 rendering, group sequential identical steps:
```typescript
// Group sequential identical steps into "Phases"
const groupedPhases = steps.reduce((acc: any[], rawStep, index) => {
  const { formattedText, originalStepNumber, title } = parseAndFormatStep(rawStep);
  
  const lastPhase = acc[acc.length - 1];
  const lastStepText = steps[index - 1] ? parseAndFormatStep(steps[index - 1]).formattedText : null;
  
  // If same action type and selector, increment count
  if (lastStepText && parseAndFormatStep(lastStepText).title === title) {
    lastPhase.count += 1;
    lastPhase.stepNumbers.push(originalStepNumber || index + 1);
    return acc;
  }
  
  // New phase starts
  return acc.concat([{ 
    title, 
    formattedText, 
    originalStepNumber: originalStepNumber || index + 1,
    count: 1,
    stepNumbers: [originalStepNumber || index + 1]
  }]);
}, []);
```

#### B. Update step rendering to show phases:
```typescript
{groupedPhases.map((phase, pIdx) => (
  <div key={`phase-${pIdx}`} className="mb-6 relative pl-6">
    <div className="absolute w-3 h-3 bg-slate-800 rounded-full -left-[7px] top-1 ring-4 ring-white"></div>
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold text-slate-400">PHASE {pIdx + 1}</span>
        <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded uppercase">{phase.title}</span>
        {phase.count > 1 && (
          <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded">
            Executed {phase.count}x
          </span>
        )}
      </div>
      <p className="text-slate-700 text-sm bg-slate-50 border border-slate-200 p-3 rounded-md shadow-sm">
        {phase.formattedText}
      </p>
    </div>
  </div>
))}
```

#### C. Vite Network Filter (NEW REQUIREMENT)
Add filter before deduplication:
```typescript
// Filter out Vite noise unless it's a real server collapse
const filteredFindings = findings ? findings.filter(bug => {
  const msg = bug.message || "";
  const type = bug.type || "";
  
  // Drop NETWORK errors with Vite noise
  if (type.includes("NETWORK") || type.includes("REQUEST")) {
    if ((msg.includes("@vite") || msg.includes(".js?v=") || msg.includes("env.mjs")) && 
        !msg.includes("server collapse")) {
      return false;
    }
  }
  return true;
}) : [];
```

#### D. Enhanced Deduplication (Already implemented but verify)
Keep the smarter grouping by TYPE + first 30 chars of message.

## Implementation Order
1. Add phase grouping logic in ReproducibleSteps.tsx
2. Update step rendering to show PHASE with count
3. Add Vite filter before findings processing
4. Verify deduplication works correctly

## Testing
After implementation:
- Sequential identical steps should show as "Phase 1: Race Condition Attack (Executed 50x)"
- Vite network noise should be filtered out
- Duplicate bugs should still be grouped with count display
