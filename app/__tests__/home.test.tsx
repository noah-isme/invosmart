import { render, screen, within } from "@testing-library/react";
import Home from "@/app/page";

describe("Home page", () => {
  it("menampilkan hero dan CTA utama", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /suite invoicing premium yang terasa seperti concierge pribadi/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", {
        name: /mulai demo/i,
      }),
    ).toHaveAttribute("href", "#experience");

    expect(
      screen.getByRole("link", {
        name: /jelajahi produk/i,
      }),
    ).toHaveAttribute("href", "#features");
  });

  it("menampilkan daftar fitur premium", () => {
    render(<Home />);

    const featureSection = screen.getByRole("heading", {
      level: 2,
      name: /satu platform untuk membuat, mengirim, hingga menutup invoice/i,
    }).closest("section");

    expect(featureSection).toBeInTheDocument();

    const featureList = within(featureSection as HTMLElement).getAllByRole("heading", {
      level: 3,
    });

    expect(featureList).toHaveLength(6);

    const expectedFeatures = [
      /ai invoice composer/i,
      /live cashflow board/i,
      /signature pdf export/i,
      /smart reminder engine/i,
      /payment-ready links/i,
      /role-based workspace/i,
    ];

    expectedFeatures.forEach((feature) => {
      expect(
        within(featureSection as HTMLElement).getByRole("heading", {
          level: 3,
          name: feature,
        }),
      ).toBeInTheDocument();
    });
  });
});
