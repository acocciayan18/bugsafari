# TODO - Step 3: Sorting Controls Implementation

## Task
Implement sorting controls in SavedEvaluationSafaris component.

## Plan

### 1. Information Gathered
- Current component has search and severity filter (ALL, CRITICAL, HIGH, CLEAR)
- Data is loaded from API and transformed to EvaluationSafari[]
- Uses useMemo for filtering: `filteredEvaluations`
- Pagination applied after filtering: `paginatedEvaluations`
- EvaluationSafari has: date (string), coverage (number), severity ('CRITICAL'|'HIGH'|'CLEAR'), status ('COMPLETED'|'CRASHED'|'HALTED')

### 2. Implementation Plan
Add sorting state and controls:
- Add SortField type: 'date' | 'coverage' | 'severity' | 'status'
- Add SortDirection type: 'asc' | 'desc'
- Add sortState: { field: SortField, direction: SortDirection }
- Default sort: date, descending (newest first)

UI Changes:
- Add sort buttons in header area next to filter buttons
- Visual indicators: arrows (↑/↓) showing active sort field and direction
- Sort buttons: Date, Coverage, Severity, Status

Sorting Logic:
- Apply sorting in useMemo BEFORE pagination
- Client-side sorting only (no backend changes)
- Preserve existing filters

### 3. Files to Edit
- developer-dashboard/src/components/SavedEvaluationSafaris.tsx

### 4. Implementation Steps
- Step 4.1: Add sort types and state (after activeFilter state)
- Step 4.2: Add sort useMemo (between filteredEvaluations and paginatedEvaluations)
- Step 4.3: Add sort buttons in UI (in the header controls area)
- Step 4.4: Add visual sort indicators with arrows
