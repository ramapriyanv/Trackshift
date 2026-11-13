import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// An isolated local session and mocked APIs: these tests never edit Spotify.
const baseURL = "http://127.0.0.1:3002";
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString("hex");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL,
    channel: process.platform === "win32" ? "chrome" : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "small-phone", use: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "npm run dev -- --port 3002",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      TRACKSHIFT_E2E: "1",
      AUTH_SECRET: process.env.E2E_AUTH_SECRET,
      AUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
    },
  },
});
