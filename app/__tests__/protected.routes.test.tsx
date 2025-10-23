import { render, screen } from "@testing-library/react";
import AppDashboardPage from "@/app/app/page";
import ProfilePage from "@/app/app/profile/page";

type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type MockSession = {
  user?: SessionUser;
};

const getServerSessionMock = vi.fn(async () => null as MockSession | null);
const redirectMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: () => getServerSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

describe("Proteksi route aplikasi", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    redirectMock.mockReset();
  });

  it("mengalihkan ke halaman login jika tidak ada sesi pada dashboard", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    await expect(AppDashboardPage()).rejects.toThrowError(/REDIRECT:\/auth\/login/);
    expect(redirectMock).toHaveBeenCalledWith("/auth/login");
  });

  it("menampilkan dashboard ketika sesi tersedia", async () => {
    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-1", name: "Siti", email: "siti@example.com" },
    });

    const view = await AppDashboardPage();
    render(view);

    expect(screen.getByRole("heading", { name: /siti/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /lihat profil/i })).toHaveAttribute("href", "/app/profile");
  });

  it("mengalihkan ke login ketika membuka profil tanpa sesi", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    await expect(ProfilePage()).rejects.toThrowError(/REDIRECT:\/auth\/login/);
    expect(redirectMock).toHaveBeenCalledWith("/auth/login");
  });

  it("menampilkan detail profil saat sesi aktif", async () => {
    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-2", name: "Budi", email: "budi@example.com" },
    });

    const view = await ProfilePage();
    render(view);

    expect(screen.getByRole("heading", { name: /budi/i })).toBeInTheDocument();
    expect(screen.getAllByText(/budi@example.com/i)).toHaveLength(2);
  });
});
