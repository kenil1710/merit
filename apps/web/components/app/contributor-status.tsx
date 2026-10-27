"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Suspend (the agent stops approving their work) or reinstate a contributor, with a reason for the audit log. */
export function ContributorStatus({ programId, contributorId, status, handle }: { programId: string; contributorId: string; status: string; handle: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = status === "suspended" ? "active" : "suspended";
  async function apply() {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/programs/${programId}/contributors/${contributorId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next, reason }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't change that.");
      toast.success(next === "suspended" ? `@${handle} suspended` : `@${handle} reinstated`);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <Textarea rows={2} aria-label="Reason" placeholder="Reason (10+ characters), kept in the audit log" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" variant={next === "suspended" ? "outline" : "default"} className="w-fit" disabled={busy || reason.trim().length < 10} onClick={() => setOpen(true)}>
        {next === "suspended" ? "Suspend" : "Reinstate"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={next === "suspended" ? `Suspend @${handle}?` : `Reinstate @${handle}?`}
        description={next === "suspended" ? "They can't submit, and the agent approves nothing more of theirs. Work already approved on chain is unaffected." : "They can submit again."}
        rows={[{ label: "Reason", value: reason }]}
        confirmLabel={next === "suspended" ? "Suspend" : "Reinstate"}
        destructive={next === "suspended"}
        onConfirm={() => {
          setOpen(false);
          void apply();
        }}
      />
    </div>
  );
}
