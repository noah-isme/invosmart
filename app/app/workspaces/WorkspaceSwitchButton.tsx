"use client";

import { useState } from "react";

export function WorkspaceSwitchButton({ organizationId, active }: { organizationId: string; active: boolean }) {
  const [busy, setBusy] = useState(false);

  if (active) return null;

  const switchWorkspace = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (response.ok) window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={switchWorkspace} disabled={busy} className="mt-4 rounded-full border border-indigo-300/30 px-4 py-2 text-sm text-indigo-200 hover:border-indigo-200/70 disabled:opacity-50">
      {busy ? "Switching…" : "Switch workspace"}
    </button>
  );
}
