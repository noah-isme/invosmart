import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import {
  deleteFlag,
  getAllFlags,
  toggleFlag,
  upsertFlag,
} from "@/lib/feature-flags";
import { authOptions } from "@/server/auth";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const flags = await getAllFlags();
    return NextResponse.json({ data: flags, flags });
  } catch (error) {
    console.error("[Admin FeatureFlags GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (body.id && body.enabled !== undefined && !body.key && !body.name) {
      const result = await toggleFlag(body.id, Boolean(body.enabled));
      return NextResponse.json({ data: result, flag: result });
    }

    if (!body.id && (!body.key || !body.name)) {
      return NextResponse.json(
        { error: "key and name are required" },
        { status: 400 }
      );
    }

    const result = await upsertFlag({
      id: body.id,
      key: body.key,
      name: body.name,
      description: body.description,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
      targetTenants: body.targetTenants,
      targetUsers: body.targetUsers,
    });

    return NextResponse.json({ data: result, flag: result }, { status: body.id ? 200 : 201 });
  } catch (error) {
    console.error("[Admin FeatureFlags POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id) {
      try {
        const body = await request.json();
        id = body.id;
      } catch {
        // body may be empty
      }
    }

    if (!id) {
      return NextResponse.json(
        { error: "Flag id is required" },
        { status: 400 }
      );
    }

    await deleteFlag(id);
    return NextResponse.json({ success: true, message: "Flag deleted successfully" });
  } catch (error) {
    console.error("[Admin FeatureFlags DELETE] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
