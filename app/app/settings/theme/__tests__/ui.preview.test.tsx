import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreviewCard } from "@/app/app/settings/theme/ThemeSettingsPanel";

describe("PreviewCard visual states", () => {
  it("menggunakan efek glow pada mode gelap", () => {
    const { container } = render(
      <PreviewCard primary="#123456" accent="#abcdef" mode="dark" />,
    );

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("bg-gradient-to-br");
    expect(card.className).toContain("shadow-[0_0_30px_rgba(8,10,26,0.55)]");
  });

  it("menggunakan border accent lembut pada mode terang", () => {
    const { container } = render(
      <PreviewCard primary="#123456" accent="#abcdef" mode="light" />,
    );

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border-accent/30");
    expect(card.className).toContain("shadow-[0_20px_45px_rgba(148,163,184,0.32)]");
  });
});
