# Step 5: Bulk Selection Implementation Plan

## Information Gathered

### Current Implementation Analysis:
- **SavedEvaluationSafaris.tsx**: Main component for displaying evaluation history
  - Data type: `EvaluationSafari[]` 
  - Pagination: `currentPage` state with `ITEMS_PER_PAGE = 10`
  - Filtering: `activeFilter` and `searchQuery` states
  - Sorting: `sortConfig` state with field/direction
  - Uses `paginatedEvaluations` derived from filtered/sorted data
  - Row action menu for individual row actions already implemented

- **historyService.ts**: Already has `deleteRecord` and `exportRecord` functions for individual records

### Features to Implement:
1. Add checkbox column for row selection
2. Support Select Row, Select All, Deselect All
3. Display selected count
4. Bulk Actions: Delete, Export, Compare (UI only for now)
5. Maintain pagination compatibility
6. Preserve filtering and sorting behavior

---

## Plan: Implementation of Bulk Selection

### File: developer-dashboard/src/components/SavedEvaluationSafaris.tsx

### Step 1: Add Selection State
- Add `selectedIds: Set<string>` state to track selected record IDs

### Step 2: Add Checkbox Column
- Add checkbox header for "select all" functionality
- Add checkbox column to each row

### Step 3: Add Selection Utils
- Add helper functions:
  - `selectRow(id)`: Select single row
  - `deselectRow(id)`: Deselect single row
  - `toggleRow(id)`: Toggle row selection
  - `selectAll()`: Select all visible (filtered/sorted) items
  - `deselectAll()`: Clear all selections

### Step 4: Add Selection Display
- Add "selected count" indicator in toolbar
- Show count like "X of Y selected"

### Step 5: Add Bulk Action Buttons
- Add bulk action toolbar when items are selected
- Support: Delete (multi), Export (multi), Compare (multi - opens comparison view)
- "Compare" will be a placeholder/basic UI for opening records side-by-side

### Step 6: Handle Pagination
- Clear selections when page changes (optional - or maintain selections)
- Properly calculate selection counts with pagination

### Step 7: Maintain Filter/Sort Compatibility
- Selection works with filtered items
- "Select All" selects only filtered items, not all data

---

## Dependent Files to be edited

1. **developer-dashboard/src/components/SavedEvaluationSafaris.tsx** - Main implementation

---

## Followup steps

1. Test the bulk selection UI
2. Verify pagination works correctly with selections
3. Verify filtering and sorting work with selections
4. Test bulk delete (already has individual delete, need to handle multi)
5. Test bulk export (similar - handle multi record export)

---

## UI Mockup Changes

### Header Row (Additions):
- [ ] Checkbox for select all
- Columns: [Select] URL | Date | Coverage | Severity | Actions

### Row (Additions):
- [ ] Checkbox for individual selection
- Shows row data as before

### Toolbar (Additions):
- Selection indicator: "X of Y items selected"
- When items selected:
  - [Delete Selected]
  - [Export Selected]
  - [Compare Selected]
  - [Clear Selection]

### Bulk Delete Dialog:
- Update confirmation message for multiple items
- Show count of items being deleted
