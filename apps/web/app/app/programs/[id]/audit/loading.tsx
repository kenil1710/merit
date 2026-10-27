import { PageSkeleton } from "@/components/ui-kit/skeletons";

export default function Loading() {
  return <PageSkeleton stats={0} rows={10} label="Loading the audit log" />;
}
