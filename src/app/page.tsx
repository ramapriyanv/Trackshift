import { signIn } from "@/auth";

function TrackShiftLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M7 4v13M7 17l-3.5-3.5M7 17l3.5-3.5" />
      <path d="M17 20V7M17 7l-3.5 3.5M17 7l3.5 3.5" />
    </svg>
  );
}

function SpotifyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.504 17.307a.748.748 0 0 1-1.03.248c-2.82-1.723-6.37-2.113-10.552-1.158a.748.748 0 1 1-.333-1.459c4.575-1.045 8.502-.595 11.667 1.339.353.216.464.677.248 1.03zm1.469-3.267a.936.936 0 0 1-1.287.31c-3.229-1.985-8.152-2.56-11.972-1.4a.936.936 0 1 1-.544-1.792c4.365-1.325 9.792-.683 13.493 1.595a.936.936 0 0 1 .31 1.287zm.126-3.403C15.23 8.339 8.845 8.128 5.15 9.25a1.123 1.123 0 1 1-.652-2.148c4.24-1.287 11.288-1.039 15.743 1.605a1.123 1.123 0 0 1-1.142 1.93z" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10 sm:px-6">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute -top-48 left-1/2 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-spotify/15 blur-[140px]" />

      <div className="relative flex flex-col items-center text-center">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-spotify text-black shadow-lg shadow-spotify/30 sm:h-14 sm:w-14">
            <TrackShiftLogo className="h-8 w-8" />
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">TrackShift</h1>
        </div>

        <p className="mt-6 max-w-md text-lg text-subtle">
          Move any song — or group of songs — anywhere in your playlists.
          Arrange and remove songs, review your changes, then apply when you&apos;re sure.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("spotify", { redirectTo: "/app" });
          }}
          className="mt-10"
        >
          <button
            type="submit"
            className="flex items-center gap-3 rounded-full bg-spotify px-6 py-4 text-base font-bold text-black transition hover:scale-[1.04] hover:bg-spotify-bright active:scale-100 sm:px-8"
          >
            <SpotifyMark className="h-6 w-6" />
            Continue with Spotify
          </button>
        </form>

        <p className="mt-8 text-xs text-subtle/70">
          TrackShift only changes playlists you can edit. Nothing is changed
          without your confirmation.
        </p>
      </div>
    </main>
  );
}
