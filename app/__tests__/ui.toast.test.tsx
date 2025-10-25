import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "@/context/ToastContext";

const TriggerToast = () => {
  const { notify } = useToast();
  return (
    <button
      type="button"
      onClick={() => notify({ title: "Toast title", description: "Toast description" })}
    >
      Trigger
    </button>
  );
};

describe("ToastProvider", () => {
  it("menampilkan dan menutup toast", async () => {
    render(
      <ToastProvider>
        <TriggerToast />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/trigger/i));

    expect(await screen.findByText(/toast title/i)).toBeInTheDocument();
    expect(await screen.findByText(/toast description/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /tutup/i }));

    expect(screen.queryByText(/toast title/i)).not.toBeInTheDocument();
  });
});
