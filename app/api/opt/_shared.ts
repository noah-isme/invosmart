import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/server/auth";

type UnauthorizedResponse = ReturnType<typeof NextResponse.json>;

type AuthResult =
  | { session: NonNullable<Awaited<ReturnType<typeof getServerSession>>>; response?: never }
  | { session: null; response: UnauthorizedResponse };

export const requireAuthenticatedSession = async (): Promise<AuthResult> => {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { session } as AuthResult;
};

export const ensureFeatureEnabled = (flag?: string) => {
  if (!flag) return true;
  return flag !== "false";
};

export const respondFeatureDisabled = () =>
  NextResponse.json({ error: "AI optimizer feature disabled" }, { status: 503 });
