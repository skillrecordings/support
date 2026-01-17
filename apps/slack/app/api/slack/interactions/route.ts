import { NextRequest, NextResponse } from "next/server";

/**
 * Slack Interactions API endpoint
 * Handles interactive components (buttons, select menus, modals, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const payload = formData.get("payload");

    if (!payload) {
      return NextResponse.json(
        { error: "Missing payload" },
        { status: 400 }
      );
    }

    const interaction = JSON.parse(payload as string);

    // TODO: Process interaction here
    console.log("Interaction received:", interaction);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error handling Slack interaction:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
