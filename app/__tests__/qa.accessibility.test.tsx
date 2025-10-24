import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("Accessibility", () => {
  it("home page has no detectable accessibility violations", async () => {
    const { container } = render(<HomePage />);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const axeCore = require("axe-core");
    const results = await axeCore.run(container);
    expect(results.violations).toHaveLength(0);
  });
});
