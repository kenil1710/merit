import { Skeleton } from "@/components/ui/skeleton";

/** Loading layout that mirrors a typical page: header, stat row, then a table. */
export function PageSkeleton({ stats = 4, rows = 6, label = "Loading" }: { stats?: number; rows?: number; label?: string }) {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label={label} data-testid="page-skeleton">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {stats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <Skeleton key={i} className="h-[84px]" />
          ))}
        </div>
      ) : null}
      <div className="grid gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </div>
    </div>
  );
}
