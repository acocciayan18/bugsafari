# TODO: Session History Frontend UI Fixes

## Overview
This document tracks frontend UI and API improvements for the Session History feature. Focus is on fixing display issues in the frontend without modifying any backend database schemas.

---

## Task 1: Remove Hardcoded Bug Text & Connect Real Data

**File:** `developer-dashboard/src/components/SavedEvaluationSafaris.tsx`

### Problem
In the expanded view of a saved session, the "AI SUGGESTED FIX" section currently displays hardcoded placeholder text (e.g., "SQL Injection Vulnerability Detected...").

### Action
- Find the hardcoded `<div className="space-y-3 text-xs text-slate-600">` block containing the fake SQL injection text.
- Replace the hardcoded `<p>` tags with a dynamic mapping over `evalItem.forensicTrace?.caughtBugs`.
- Render using this structure:

```tsx
{evalItem.forensicTrace?.caughtBugs?.map((bug) => (
  <div key={bug.bugId} className="p-3 border border-slate-200 rounded">
    <div className="font-semibold text-red-600">{bug.type}</div>
    <div className="text-slate-700">{bug.message}</div>
    <div className="text-xs text-slate-500 mt-1">Advice: {bug.advice}</div>
  </div>
))}
```

### Implementation Steps
- [x] Locate the hardcoded placeholder text in SavedEvaluationSafaris.tsx (around lines 380-395)
- [x] Replace with dynamic rendering from `evalItem.forensicTrace?.caughtBugs`
- [x] Add fallback UI for when no bugs are found

#### Fallback UI (for empty bugs)
```tsx
{!evalItem.forensicTrace?.caughtBugs?.length ? (
  <div className="text-sm text-slate-500 italic">
    No critical vulnerabilities detected in this trace.
  </div>
) : (
  evalItem.forensicTrace?.caughtBugs?.map((bug) => (
    <div key={bug.bugId} className="p-3 border border-slate-200 rounded">
      <div className="font-semibold text-red-600">{bug.type}</div>
      <div className="text-slate-700">{bug.message}</div>
      <div className="text-xs text-slate-500 mt-1">Advice: {bug.advice}</div>
    </div>
  ))
)}
```

---

## Task 2: Add "Findings" Column to Dashboard History

**File:** `developer-dashboard/src/components/ClinicalForensicsDashboard.tsx`

### Problem
The inline history table only shows 3 columns (Timestamp, Target URL, Status). It is missing the bug count.

### Action
- Locate the table header `<thead>` for the history tab. Add a new `<th>` for **Findings**:
```tsx
<th className="border border-slate-200 px-3 py-2">Findings</th>
```
- Locate the table body `<tbody>` where the rows are mapped. Add the corresponding `<td>`:
```tsx
<td className="border border-slate-200 px-3 py-2">{entry.findingCount}</td>
```

### Implementation Steps
- [x] Find history tab table in ClinicalForensicsDashboard.tsx (around lines 530-555)
- [x] Add Findings column header to `<thead>`
- [x] Add Findings cell to each table row in `<tbody>`

---

## Task 3: Update URL Tracking Signature in API Service

**File:** `developer-dashboard/src/services/historyService.ts`

### Problem
The `saveSessionToHistory` function only accepts a single `targetUrl` string, but needs to support tracking both the final runtime URL and the initial input URL.

### Action
- Update the function signature to:
```typescript
export async function saveSessionToHistory(
  targetUrl: string, 
  options?: { initialUrl?: string }
): Promise<void>
```
- Update the POST payload to include `options.initialUrl` if provided

### Implementation Steps
- [x] Update function signature in historyService.ts
- [x] Modify POST body to include initialUrl when present
- [x] Check for any calling components that need updates (optional param should prevent breaks)

#### POST Body Structure
```typescript
const payload = {
  url: targetUrl,
  ...(options?.initialUrl && { initialUrl: options.initialUrl })
};
// This ensures the body looks like: { url: "https://example.com/login", initialUrl: "https://example.com" }
```

Example usage:
```typescript
await fetch(`${API_BASE_URL}/api/history/save-session`, {
  method: 'POST',
  headers: getAuthHeaders(),
  body: JSON.stringify(payload),
});
```

---

## Completed Tasks

### Previously Completed
- ✅ Sidebar tab renamed from "Forensic History" to "Sessions History"
- ✅ Refresh button added to SavedEvaluationSafaris header
- ✅ Re-fetch logic implemented on click
- ✅ Step parsing helper created (`parseStepString` function)
- ✅ Visual formatting with icons and colors added

---

## Files Modified

| File | Task | Status |
|------|------|--------|
| `SavedEvaluationSafaris.tsx` | Task 1: Display real captured bugs | ✅ Done |
| `ClinicalForensicsDashboard.tsx` | Task 2: Add Findings column | ✅ Done |
| `historyService.ts` | Task 3: URL tracking signature | ✅ Done |
| `useDashboardController.ts` | Task 4: Use runtime URL | ✅ Done |
| `LiveFeed.tsx` | Task 5: Fix TypeScript props | ✅ Done |

---

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/history` | Get saved safari sessions |
| `POST /api/history/save-session` | Save current session |
| `GET /api/history/sessions` | Get session history entries |

---

## Types Reference

```typescript
interface CaughtBug {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: string;
}

interface ForensicTrace {
  finalBreadcrumbSteps: string[];
  caughtBugs: CaughtBug[];
}
```

---

## Task 4: Create the Parser Utility

**File:** `developer-dashboard/src/utils/semanticFormatter.ts`

### Purpose
This parses strings like `"Step 1: BUTTON-SPAMMER body > div... at http..."` into readable English for the timeline view.

### Implementation Steps
- [ ] Create new file `developer-dashboard/src/utils/semanticFormatter.ts`
- [ ] Add the `parseAndFormatStep` function

### Code to Add
```typescript
export function parseAndFormatStep(rawStep: string): { formattedText: string, originalStepNumber: number } {
  // Extract step number
  const stepMatch = rawStep.match(/^Step (\d+):/);
  const stepNumber = stepMatch ? parseInt(stepMatch[1], 10) : 0;

  // Remove "Step X: " and " at http..."
  const withoutPrefix = rawStep.replace(/^Step \d+: /, '');
  const [actionAndSelector] = withoutPrefix.split(' at http');

  // Split action type and selector
  const spaceIndex = actionAndSelector.indexOf(' ');
  const actionType = spaceIndex > -1 ? actionAndSelector.substring(0, spaceIndex) : actionAndSelector;
  const selector = spaceIndex > -1 ? actionAndSelector.substring(spaceIndex + 1) : '';

  // Clean the selector (remove ugly nth-of-type)
  const cleanSelector = selector.split(' > ').pop()?.replace(/:nth-of-type\(\d+\)/g, '') || selector;

  let formattedText = `${actionType} on <${cleanSelector}>`;
  if (actionType.includes('ROUTETRASHER')) formattedText = `Executed RouteTrasher stress scenario on <${cleanSelector}>`;
  else if (actionType.includes('BUTTON-SPAMMER')) formattedText = `Spam-clicked <${cleanSelector}>`;
  else if (actionType.toLowerCase().includes('click')) formattedText = `Clicked <${cleanSelector}>`;

  return { formattedText, originalStepNumber: stepNumber };
}
```

---

## Task 5: Create the Timeline Component

**File:** `developer-dashboard/src/components/ReproducibleSteps.tsx`

### Purpose
Displays the steps to reproduce in a visual timeline format with bug findings integrated.

### Implementation Steps
- [ ] Create new file `developer-dashboard/src/components/ReproducibleSteps.tsx`
- [ ] Import `parseAndFormatStep` from the utility file
- [ ] Implement the timeline rendering logic

### Code to Add
```typescript
import React from 'react';
import { parseAndFormatStep } from '../utils/semanticFormatter';

interface ReproducibleStepsProps {
  steps: string[];
  findings: any[];
}

export const ReproducibleSteps: React.FC<ReproducibleStepsProps> = ({ steps, findings }) => {
  if (!steps || steps.length === 0) return <div className="text-sm text-slate-500">No steps recorded.</div>;

  return (
    <div className="bg-white border border-slate-200 p-6 rounded-md shadow-sm mt-4">
      <h3 className="text-sm font-bold mb-6 uppercase tracking-wider text-slate-800 border-b pb-2">
        Steps to Reproduce
      </h3>
      <div className="relative border-l-2 border-slate-200 ml-3">
        {steps.map((rawStep, index) => {
          const { formattedText, originalStepNumber } = parseAndFormatStep(rawStep);
          
          // Find bugs that happened at this specific step
          const triggeredBugs = findings?.filter(f => {
            return index === steps.length - 1; 
          }) || [];

          return (
            <div key={index} className="mb-6 relative pl-6">
              {/* Timeline Dot */}
              <div className="absolute w-3 h-3 bg-slate-800 rounded-full -left-[7px] top-1 ring-4 ring-white"></div>
              
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-400 mb-1">STEP {originalStepNumber || index + 1}</span>
                <p className="text-slate-700 font-mono text-sm bg-slate-50 border border-slate-100 inline-block px-3 py-1.5 rounded w-fit">
                  {formattedText}
                </p>
              </div>

              {/* Render Bug if it occurred here */}
              {index === steps.length - 1 && findings && findings.length > 0 && (
                <div className="mt-4 flex flex-col gap-3">
                  {findings.map((bug, bIdx) => (
                    <div key={bIdx} className="border-l-4 border-red-500 bg-red-50 p-4 rounded-r-md">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-red-600 font-bold text-sm">🔥 {bug.type}</span>
                      </div>
                      <p className="text-sm text-slate-700 mb-2 font-medium">{bug.message}</p>
                      {bug.advice && <p className="text-xs text-slate-600 italic">Advice: {bug.advice}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

---

## Task 6: Replace the Dark Blue Box in the UI

**File:** `developer-dashboard/src/components/SavedEvaluationSafaris.tsx`

### Purpose
Replace the current dark theme container for "STEPS TO REPRODUCE" with the new ReproducibleSteps component.

### Action
- Import the new component: `import { ReproducibleSteps } from './ReproducibleSteps';`
- Find "STEPS TO REPRODUCE" section
- Replace the entire dark block with:
```typescript
<ReproducibleSteps 
  steps={evalItem.forensicTrace?.finalBreadcrumbSteps || []} 
  findings={evalItem.forensicTrace?.caughtBugs || []} 
/>
```

### Implementation Steps
- [ ] Add import for ReproducibleSteps component
- [ ] Find the existing "STEPS TO REPRODUCE" section (dark bg-slate-900 container)
- [ ] Replace with ReproducibleSteps component

---

## Updated Files Modified

| File | Task | Status |
|------|------|--------|
| `SavedEvaluationSafaris.tsx` | Task 1: Display real captured bugs | ✅ Done |
| `ClinicalForensicsDashboard.tsx` | Task 2: Add Findings column | ✅ Done |
| `historyService.ts` | Task 3: URL tracking signature | ✅ Done |
| `semanticFormatter.ts` | Task 4: Create parser utility | ✅ Done |
| `ReproducibleSteps.tsx` | Task 5: Create timeline component | ✅ Done |
| `SavedEvaluationSafaris.tsx` | Task 6: Replace dark blue box | ✅ Done |
