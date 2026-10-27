import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HexValue } from "@/components/hex-value";
import { KelvinText } from "@/components/kelvin-text";
import { Card, PageHeader } from "@/components/ui-kit";
import { RpcClient } from "@/lib/merit/chain";
import { RPC_UPSTREAM } from "@/lib/merit/constants";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Transaction" };

type Params = { params: Promise<{ sig: string }> };

export default async function TransactionPage({ params }: Params) {
  const { sig } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) notFound();
  let result: Awaited<ReturnType<RpcClient["logs"]>>;
  try {
    result = await new RpcClient(RPC_UPSTREAM).logs(sig);
  } catch {
    notFound();
  }
  const merit = result.logs.filter((l) => l.includes("Program log: Merit "));
  const failed = Boolean(result.err);
  return (
    <div className="grid gap-8">
      <PageHeader
        crumbs={[{ label: "Explore", href: "/explore" }, { label: "Transaction" }]}
        title="Transaction"
        meta={
          <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium", failed ? "bg-danger-subtle text-danger" : "bg-success-subtle text-success")}>
            {failed ? "Failed" : "Success"}
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <HexValue value={sig} label="signature" head={16} tail={8} />
            {result.blockTime ? <span className="text-muted-foreground">{new Date(result.blockTime).toISOString().replace("T", " ").slice(0, 19)} UTC</span> : null}
          </span>
        }
      />
      {merit.length ? (
        <Card title="What Merit recorded">
          <ul className="grid gap-2" data-testid="merit-lines">
            {merit.map((l, i) => (
              <li key={i} className="bg-muted/50 rounded-lg px-3 py-2 text-sm break-all"><KelvinText text={l.replace(/^.*Program log: /, "")} /></li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Full program log" description="Exactly as the Rialo DevNet node returned it.">
        <pre className="bg-muted/40 overflow-x-auto rounded-xl p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{result.logs.join("\n")}</pre>
        {failed ? <pre className="text-danger mt-3 font-mono text-xs">{JSON.stringify(result.err)}</pre> : null}
      </Card>
    </div>
  );
}
