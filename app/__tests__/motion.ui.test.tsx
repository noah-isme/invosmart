import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/dashboard",
}));

import { PageTransition } from "@/components/layout/PageTransition";

describe("PageTransition", () => {
  it("wraps children with animated container", () => {
    render(
      <PageTransition>
        <div>Halaman uji</div>
      </PageTransition>,
    );

    expect(screen.getByTestId("page-transition")).toBeInTheDocument();
    expect(screen.getByText(/Halaman uji/)).toBeInTheDocument();
  });
});
