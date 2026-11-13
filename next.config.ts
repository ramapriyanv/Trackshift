import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app must be opened at http://127.0.0.1:3000 (Spotify rejects
  // "localhost" redirect URIs), so allow that origin for dev assets.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.scdn.co" },
      { protocol: "https", hostname: "*.spotifycdn.com" },
    ],
  },
};

export default nextConfig;
