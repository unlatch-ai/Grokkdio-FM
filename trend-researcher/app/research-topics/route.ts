import { NextResponse } from "next/server";
import {
  researchTopics,
  getAvailablePersonalities,
} from "../researcherService";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const personality = searchParams.get("personality") || undefined;

    const result = await researchTopics({ personality });

    return NextResponse.json({
      ...result,
      availablePersonalities: getAvailablePersonalities(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
