import { type NextAuthOptions, type Profile } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { db } from "@/lib/db";
import { verify } from "@/lib/hash";
import { LoginSchema } from "@/lib/schemas";
import { createUserWithPersonalWorkspace, isUniqueConstraintError } from "@/lib/workspaces";
import { logAuditEvent, AuditAction, AuditEntity } from "@/lib/audit/auditLogger";

const providers: NextAuthOptions["providers"] = [
  Credentials({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const parsed = LoginSchema.safeParse({
        email: credentials?.email ?? "",
        password: credentials?.password ?? "",
      });

      if (!parsed.success) {
        void logAuditEvent({
          action: AuditAction.AUTH_LOGIN_FAILURE,
          entity: AuditEntity.AUTH,
          details: { reason: "invalid_input", email: credentials?.email ?? null },
        });
        return null;
      }

      const { email, password } = parsed.data;

      const user = await db.user.findUnique({
        where: { email },
      });

      if (!user || !user.password) {
        void logAuditEvent({
          action: AuditAction.AUTH_LOGIN_FAILURE,
          entity: AuditEntity.AUTH,
          details: { reason: "user_not_found", email },
        });
        return null;
      }

      const valid = await verify(password, user.password);
      if (!valid) {
        void logAuditEvent({
          userId: user.id,
          action: AuditAction.AUTH_LOGIN_FAILURE,
          entity: AuditEntity.AUTH,
          details: { reason: "invalid_password", email },
        });
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
      };
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

/**
 * Error codes surfaced on `/auth/login?error=<code>`. The login form maps each
 * one to a user-facing message; raw error messages must never reach the URL
 * (next-auth would otherwise echo a thrown `error.message` into it).
 */
export const GOOGLE_SIGNIN_ERRORS = {
  /** Google did not assert `email_verified: true` for this identity. */
  emailNotVerified: "GoogleEmailNotVerified",
  /** A password (credentials) account already owns this email. */
  passwordAccountExists: "GooglePasswordAccountExists",
  /** Any unexpected failure; details are logged server-side only. */
  failed: "OAuthCallback",
} as const;

const loginErrorRedirect = (code: string) => `/auth/login?error=${encodeURIComponent(code)}`;

type GoogleDbUser = { id: string; email: string; name: string | null };

type GoogleUserResult =
  | { status: "ok"; user: GoogleDbUser }
  | { status: "password_account"; userId: string };

/**
 * Sign-in with Google has no adapter (JWT sessions), so the user row is
 * created here. First sign-in creates the user together with a personal
 * workspace. Returning Google-only users (no password) only get their display
 * name refreshed, so an existing user without a membership is not
 * auto-provisioned (enforce mode keeps failing closed for them).
 *
 * An existing user that has a password is never linked: registration does not
 * verify email ownership, so anyone could have pre-registered a victim's
 * address. Those users must keep signing in with their password.
 */
const upsertGoogleUser = async (email: string, name: string): Promise<GoogleUserResult> => {
  const signInExisting = async (existing: {
    id: string;
    password?: string | null;
  }): Promise<GoogleUserResult> => {
    if (existing.password != null) {
      return { status: "password_account", userId: existing.id };
    }
    return { status: "ok", user: await db.user.update({ where: { email }, data: { name } }) };
  };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return signInExisting(existing);
  }

  try {
    const user = await createUserWithPersonalWorkspace<GoogleDbUser>({
      email,
      name,
      password: null,
    });
    return { status: "ok", user };
  } catch (error) {
    // Lost a race with a concurrent first sign-in or registration for the same
    // email. Re-read the winner: only a password-less user may be signed in.
    if (isUniqueConstraintError(error)) {
      const winner = await db.user.findUnique({ where: { email } });
      if (winner) {
        return signInExisting(winner);
      }
    }
    throw error;
  }
};

const auditGoogleRefusal = (reason: string, userId?: string) => {
  void logAuditEvent({
    userId: userId ?? null,
    action: AuditAction.AUTH_LOGIN_FAILURE,
    entity: AuditEntity.AUTH,
    details: { provider: "google", reason },
  });
};

type GoogleSignInArgs = {
  user: { id?: string; email?: string | null; name?: string | null };
  account: { providerAccountId?: string } | null;
  /** Raw Google ID-token claims (`GoogleProfile`); `email_verified` is not on next-auth's base `Profile`. */
  profile?: Profile | null;
};

/**
 * Returns `true` to continue, or a relative redirect (next-auth accepts a
 * string from `signIn` as the redirect target). Never throws.
 */
const handleGoogleSignIn = async ({
  user,
  profile,
}: GoogleSignInArgs): Promise<true | string> => {
  try {
    // Google's ID token carries `email_verified`; next-auth passes the raw
    // claims as `profile`. Require a real boolean `true` (fail closed).
    if ((profile as { email_verified?: unknown } | null | undefined)?.email_verified !== true) {
      auditGoogleRefusal("email_not_verified");
      return loginErrorRedirect(GOOGLE_SIGNIN_ERRORS.emailNotVerified);
    }

    if (!user.email) {
      auditGoogleRefusal("missing_email");
      return loginErrorRedirect(GOOGLE_SIGNIN_ERRORS.failed);
    }

    const email = user.email.toLowerCase();
    const result = await upsertGoogleUser(email, user.name ?? email);

    if (result.status === "password_account") {
      auditGoogleRefusal("password_account_exists", result.userId);
      return loginErrorRedirect(GOOGLE_SIGNIN_ERRORS.passwordAccountExists);
    }

    user.id = result.user.id;
    user.email = result.user.email;
    user.name = result.user.name ?? user.name;
    return true;
  } catch (error) {
    // Log only the error class/code, not the message: Prisma messages can
    // embed query arguments (email addresses).
    const code = (error as { code?: unknown } | null)?.code;
    console.error("[auth] Google sign-in failed", {
      name: error instanceof Error ? error.name : typeof error,
      code: typeof code === "string" ? code : undefined,
    });
    return loginErrorRedirect(GOOGLE_SIGNIN_ERRORS.failed);
  }
};

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/auth/login",
    error: "/auth/login",
  },
  events: {
    async signIn({ user, account }) {
      void logAuditEvent({
        userId: user?.id ?? null,
        action: AuditAction.AUTH_LOGIN_SUCCESS,
        entity: AuditEntity.AUTH,
        details: {
          provider: account?.provider ?? "credentials",
          email: user?.email ?? null,
        },
      });
    },
    async signOut({ token, session }) {
      const userId = token?.sub ?? (session as { user?: { id?: string } })?.user?.id ?? null;
      const email = token?.email ?? (session as { user?: { email?: string } })?.user?.email ?? null;
      void logAuditEvent({
        userId,
        action: AuditAction.AUTH_LOGOUT,
        entity: AuditEntity.AUTH,
        details: {
          email,
        },
      });
    },
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        return handleGoogleSignIn({ user, account, profile });
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }

      if (user?.email) {
        token.email = user.email;
      }

      if (user?.name) {
        token.name = user.name;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      if (session.user && token.email) {
        session.user.email = token.email as string;
      }

      if (session.user && token.name) {
        session.user.name = token.name as string;
      }

      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }

      try {
        const targetUrl = new URL(url);
        if (targetUrl.origin === baseUrl) {
          return url;
        }
      } catch {
        // Ignore invalid URLs and fallback to baseUrl.
      }

      return baseUrl;
    },
  },
};
