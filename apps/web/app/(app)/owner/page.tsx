import type { Metadata } from "next";
import { PageHeader } from "@/components/ui-kit";
import { OwnerDashboard } from "./OwnerDashboard";

export const metadata: Metadata = { title: "Run a campaign" };

export default function OwnerPage() {
  return (
    <div className="grid gap-8">
      <PageHeader
        title={<>Run a <em>campaign</em></>}
        description="Your wallet signs every owner instruction in this browser. The program holds the escrow; the agent can only approve within the caps you set, and only the round's own timer can pay."
      />
      <OwnerDashboard />
    </div>
  );
}
