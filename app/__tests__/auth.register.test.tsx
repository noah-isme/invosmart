import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RegisterPage from "@/app/auth/register/page";

const push = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();

const originalFetch = global.fetch;
const getFetchMock = () => global.fetch as unknown as ReturnType<typeof vi.fn>;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    refresh,
    replace,
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

describe("Halaman register", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    replace.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("menampilkan form register dengan seluruh field", () => {
    render(<RegisterPage />);

    expect(screen.getByRole("heading", { name: /daftar akun baru/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/nama lengkap/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("menampilkan error validasi ketika submit kosong", async () => {
    render(<RegisterPage />);

    fireEvent.submit(screen.getByRole("button", { name: /daftar/i }).closest("form") as HTMLFormElement);

    expect(await screen.findByText(/periksa kembali data yang anda masukkan/i)).toBeInTheDocument();
    expect(screen.getByText(/nama minimal 2 karakter/i)).toBeInTheDocument();
    expect(screen.getByText(/email wajib diisi/i)).toBeInTheDocument();
    expect(screen.getByText(/password minimal 6 karakter/i)).toBeInTheDocument();
  });

  it("mengalihkan ke halaman login setelah registrasi berhasil", async () => {
    getFetchMock().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/nama lengkap/i), {
      target: { value: "Budi" },
    });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "budi@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "rahasia123" },
    });

    fireEvent.submit(screen.getByRole("button", { name: /daftar/i }).closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/auth/login?registered=1");
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("menampilkan pesan error ketika email sudah terdaftar", async () => {
    getFetchMock().mockResolvedValue(
      new Response(JSON.stringify({ error: "Email sudah terdaftar." }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/nama lengkap/i), {
      target: { value: "Budi" },
    });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "budi@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "rahasia123" },
    });

    fireEvent.submit(screen.getByRole("button", { name: /daftar/i }).closest("form") as HTMLFormElement);

    expect(await screen.findByText(/email sudah terdaftar/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
