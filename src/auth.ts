import NextAuth from "next-auth";
import Spotify from "next-auth/providers/spotify";

const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshTokenError";
  }
}

interface SpotifyJwt {
  accessToken?: string;
  refreshToken?: string;
  /** Unix seconds when the access token expires. */
  expiresAt?: number;
  error?: "RefreshTokenError";
}

async function refreshAccessToken(token: SpotifyJwt): Promise<SpotifyJwt> {
  try {
    const basic = Buffer.from(
      `${process.env.AUTH_SPOTIFY_ID}:${process.env.AUTH_SPOTIFY_SECRET}`,
    ).toString("base64");

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken ?? "",
      }),
    });

    const data = await res.json();
    if (!res.ok) throw data;

    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
      refreshToken: data.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Spotify({
      authorization: {
        url: "https://accounts.spotify.com/authorize",
        params: { scope: SPOTIFY_SCOPES },
      },
    }),
  ],
  pages: {
    signIn: "/",
  },
  callbacks: {
    async jwt({ token, account }) {
      // Initial sign-in: persist Spotify tokens on the JWT.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }

      const t = token as SpotifyJwt & typeof token;
      // Refresh 60s before expiry.
      if (t.expiresAt && Date.now() < (t.expiresAt - 60) * 1000) {
        return token;
      }
      return { ...token, ...(await refreshAccessToken(t)) };
    },
    async session({ session, token }) {
      const t = token as SpotifyJwt;
      session.accessToken = t.accessToken;
      session.error = t.error;
      return session;
    },
  },
});
