import { PageSkeleton } from "@/components/ui-kit/skeletons";

export default function Loading() {
  return <PageSkeleton stats={0} rows={8} label="Loading submissions" />;
}
