import "server-only";

import { createJudge } from "@/lib/agent/judge";
import type { PipelineDeps } from "@/lib/agent/pipeline";
import { fetchXPost } from "@/lib/agent/x";
import { findLedger, loadState } from "@/lib/merit/chain";
import { agentKeypair, approveOnChain, ensureLedger, revokeOnChain, rpc } from "./agent";
import { configured, env } from "./env";
import { judgeClient, xGet } from "./latch";
import { store } from "./store";

/** The agent's real dependencies: X through merit-x, Claude through merit-judge, Rialo DevNet, the agent key. */
export function agentDeps(): PipelineDeps {
  const keypair = agentKeypair();
  return {
    fetchPost: (id, campaign) => fetchXPost(id, (path) => xGet(path, campaign)),
    judge: configured(env.judgeLat).ok ? createJudge({ clientFor: (campaign) => judgeClient(campaign).messages }) : null,
    loadCampaign: (a) => loadState(rpc, a),
    loadLedger: (c) => findLedger(rpc, c, c.round),
    approve: async (campaign, a) => {
      await ensureLedger(campaign);
      return { signature: await approveOnChain(campaign, a) };
    },
    revoke: async (campaign, index) => ({ signature: await revokeOnChain(campaign, index) }),
    signer: { address: keypair.publicKey.toString(), sign: (m) => keypair.sign(m).toBytes() },
    saveJudgement: (postId, value) => store.saveJudgement(postId, value),
  };
}
