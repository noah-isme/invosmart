"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function AcceptWorkspaceInvitationContent() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Checking invitation…");

  useEffect(() => {
    if (!token) return;

    void fetch(`/api/workspace-invitations/${encodeURIComponent(token)}/accept`, { method: "POST" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error || "Unable to accept invitation");
        setState("success");
        setMessage("You are now a member of the workspace.");
      })
      .catch((error: unknown) => {
        setState("error");
        setMessage(error instanceof Error ? error.message : "Unable to accept invitation");
      });
  }, [token]);

  const displayState = token ? state : "error";
  const displayMessage = token ? message : "This invitation link is missing its token.";

  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-indigo-300">Workspace invitation</p>
      <h1 className="mt-3 text-3xl font-semibold text-white">{displayState === "success" ? "Welcome to the team" : "Invitation status"}</h1>
      <p className={`mt-4 text-sm ${displayState === "error" ? "text-rose-200" : "text-white/70"}`}>{displayMessage}</p>
      {displayState !== "loading" ? <Link href="/app/workspaces" className="mt-6 rounded-full bg-indigo-500 px-5 py-2 text-sm font-medium text-white">Open workspaces</Link> : null}
    </section>
  );
}

export default function AcceptWorkspaceInvitationPage() {
  return (
    <Suspense fallback={<section className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center justify-center px-4 text-center text-sm text-white/70">Loading invitation…</section>}>
      <AcceptWorkspaceInvitationContent />
    </Suspense>
  );
}
