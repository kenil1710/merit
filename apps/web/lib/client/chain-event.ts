// After the owner signs a campaign transaction, record it in the program's audit log (best effort: the chain has it).
export async function recordChainEvent(programId: string, signature: string) {
  await fetch(`/api/owner/programs/${programId}/chain-event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature }),
  }).catch(() => undefined);
}
