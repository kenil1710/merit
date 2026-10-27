import { PageSkeleton } from "@/components/ui-kit/skeletons";

export default function Loading() {
  return <PageSkeleton stats={4} rows={5} label="Loading the treasury" />;
}
