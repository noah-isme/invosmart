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

  it("menampilkan rencana sprint phase 1 lengkap", () => {
    render(<Home />);

    const planHeading = screen.getByRole("heading", {
      level: 2,
      name: /phase 1 — mvp development sprint plan/i,
    });

    const planSection = planHeading.closest("section");

    expect(planSection).toBeInTheDocument();

    const sprintTitles = [
      "Sprint 0 — Persiapan & Fondasi Teknis",
      "Sprint 1 — Authentication & Authorization",
      "Sprint 2 — Dashboard & Invoice CRUD",
      "Sprint 3 — AI Invoice Generator",
      "Sprint 4 — Export & Branding",
      "Sprint 5 — Insight & Analytics",
      "Sprint 6 — QA & Hardening",
    ];

    sprintTitles.forEach((title) => {
      expect(
        within(planSection as HTMLElement).getByRole("heading", {
          level: 3,
          name: new RegExp(title, "i"),
        }),
      ).toBeInTheDocument();
    });

    expect(
      within(planSection as HTMLElement).getByText(/setup \.env lokal/i),
    ).toBeInTheDocument();

    expect(
      within(planSection as HTMLElement).getByText(/export pdf siap digunakan\./i),
    ).toBeInTheDocument();
  });
});
