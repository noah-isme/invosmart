import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import AiFederationClient, {
  type FederationDashboardState,
} from "@/app/devtools/ai-federation/AiFederationClient";
import { getFederationAgent } from "@/lib/ai/federationAgent";
import { federationBus } from "@/lib/federation/bus";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

export const metadata = {
  title: "AI Federation Network",
};

export default async function AiFederationPage() {
  const session = await getServerSession(authOptions);

  if (!canViewPerfTools(session)) {
    redirect("/app");
  }

  const agent = getFederationAgent();
  const status = federationBus.getStatus();

  const initialState: FederationDashboardState = {
    enabled: federationBus.isEnabled,
    tenantId: status.tenantId,
    endpoints: status.endpoints,
    connections: status.connections,
    recentEvents: status.recentEvents,
    snapshots: agent.getSnapshots(),
    trustHistory: agent.getTrustHistory(),
    modelHistory: agent.getModelHistory(),
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">DevTools</p>
        <h1 className="text-3xl font-semibold text-text">AI Federation Network</h1>
        <p className="text-sm text-text/65">
          Visualisasi jaringan lintas tenant, metrik trust global, dan sinkronisasi federated learning.
        </p>
      </header>

      <AiFederationClient initialState={initialState} />
    </main>
  );
}
