// Shimmer placeholder sized by the caller to mirror the shape of the content it
// stands in for, so the layout does not jump when the real data lands.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-(--surface-inset) ${className}`} />;
}
