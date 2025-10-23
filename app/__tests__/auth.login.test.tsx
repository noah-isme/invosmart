import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signIn } from "next-auth/react";
import LoginForm from "@/app/auth/login/login-form";

const push = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
const signInMock = signIn as unknown as ReturnType<typeof vi.fn>;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    refresh,
    replace,
  }),
  useSearchParams: () => ({
    get: (key: string) => searchParams.get(key),
  }),
}));

describe("Halaman login", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    push.mockReset();
    refresh.mockReset();
    replace.mockReset();
    signInMock.mockReset();
  });

  it("menampilkan form login lengkap beserta pesan sukses registrasi", () => {
    searchParams = new URLSearchParams({ registered: "1" });

    render(<LoginForm />);

    expect(screen.getByRole("heading", { name: /masuk ke invosmart/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByText(/registrasi berhasil\. silakan masuk dengan kredensial anda\./i),
    ).toBeInTheDocument();
  });

  it("menampilkan error validasi ketika form kosong disubmit", async () => {
    render(<LoginForm />);

    fireEvent.submit(screen.getByRole("button", { name: /masuk/i }).closest("form") as HTMLFormElement);

    expect(await screen.findByText(/periksa kembali data yang anda masukkan/i)).toBeInTheDocument();
    expect(screen.getByText(/email wajib diisi/i)).toBeInTheDocument();
    expect(screen.getByText(/password minimal 6 karakter/i)).toBeInTheDocument();
  });

  it("melakukan redirect ke dashboard ketika login sukses", async () => {
    signInMock.mockResolvedValue({ ok: true, url: "/app" });

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "rahasia123" },
    });

    fireEvent.submit(screen.getByRole("button", { name: /masuk/i }).closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("credentials", expect.objectContaining({
        email: "user@example.com",
        password: "rahasia123",
        redirect: false,
        callbackUrl: "/app",
      }));
    });

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/app");
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("menampilkan pesan error ketika kredensial salah", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin" });

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "user@example.com" },
    });

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "rahasia123" },
    });

    fireEvent.submit(screen.getByRole("button", { name: /masuk/i }).closest("form") as HTMLFormElement);

    expect(await screen.findByText(/email atau password salah/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
