import { PageSkeleton } from "@/components/ui-kit/skeletons";

export default function Loading() {
  return <PageSkeleton stats={0} rows={6} label="Loading the contributor" />;
}
