import { render, screen, within } from "@testing-library/react";
import Home from "@/app/page";

describe("Home page", () => {
  it("menampilkan hero dan CTA utama", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /buat, kelola, dan analisis invoice profesional dalam hitungan detik/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", {
        name: /lihat mvp/i,
      }),
    ).toHaveAttribute("href", "#mvp");

    expect(
      screen.getByRole("link", {
        name: /baca roadmap teknis/i,
      }),
    ).toHaveAttribute("href", "#roadmap");
  });

  it("menampilkan daftar fitur MVP sesuai README", () => {
    render(<Home />);

    const featureSection = screen.getByRole("heading", {
      level: 2,
      name: /fitur mvp invosmart/i,
    }).closest("section");

    expect(featureSection).toBeInTheDocument();

    const featureList = within(featureSection as HTMLElement).getAllByRole("heading", {
      level: 3,
    });

    expect(featureList).toHaveLength(6);

    const expectedFeatures = [
      /autentikasi & otorisasi/i,
      /dashboard invoice/i,
      /ai invoice generator/i,
      /manual invoice form/i,
      /export ke pdf/i,
      /manajemen status/i,
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
