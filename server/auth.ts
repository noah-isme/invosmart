import { type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { db } from "@/lib/db";
import { verify } from "@/lib/hash";
import { LoginSchema } from "@/lib/schemas";
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
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        if (!user.email) {
          return false;
        }

        const email = user.email.toLowerCase();
        const dbUser = await db.user.upsert({
          where: { email },
          update: {
            name: user.name ?? email,
          },
          create: {
            email,
            name: user.name ?? email,
            password: null,
          },
        });

        user.id = dbUser.id;
        user.email = dbUser.email;
        user.name = dbUser.name ?? user.name;
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
