import { NextRequest, NextResponse } from "next/server";

/**
 * Slack Events API endpoint
 * Handles URL verification challenge and event callbacks
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    // Handle event callbacks
    if (body.type === "event_callback") {
      // TODO: Process events here
      console.log("Event received:", body.event);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error handling Slack event:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
