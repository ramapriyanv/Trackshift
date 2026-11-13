import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEditablePlaylists, SpotifyApiError } from "@/lib/spotify";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const playlists = await getEditablePlaylists(session.accessToken);
    return NextResponse.json({ playlists });
  } catch (err) {
    const status = err instanceof SpotifyApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status });
  }
}
