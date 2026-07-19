// Hard ceiling on per-run forensic row reads. A single run can emit thousands of
// network/console rows; unbounded finds hydrate all of them into memory at once.
export const MAX_FORENSIC_ROWS = 5000;
