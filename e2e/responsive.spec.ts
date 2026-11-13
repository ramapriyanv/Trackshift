import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { planMoves } from "../src/lib/reorder";
import type { PlaylistEdit } from "../src/types/move-command";
import type { PlaylistTrack } from "../src/types/spotify";

const tracks: PlaylistTrack[] = Array.from({ length: 120 }, (_, index) => ({
  id: String(index), uri: `spotify:track:test${index}`, name: `Song ${index + 1}`,
  artists: [index % 2 ? "Other Artist" : "Test Artist"], album: "Test Album",
  albumImageUrl: null, releaseDate: index % 2 ? "2018" : "2015", durationMs: 180000, isLocal: false,
}));
const playlists = Array.from({ length: 40 }, (_, index) => ({
  id: `playlist-${index}`, name: index === 0 ? "Regional — a very long playlist title" : `Playlist ${index + 1}`,
  imageUrl: null, trackCount: tracks.length, ownerName: "Test User",
}));

async function session(context: BrowserContext) {
  const token = await encode({
    secret: process.env.E2E_AUTH_SECRET!, salt: "authjs.session-token",
    token: { sub: "responsive-test", name: "Test User", accessToken: "mock-only", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
  });
  await context.addCookies([{ name: "authjs.session-token", value: token, url: "http://127.0.0.1:3002", httpOnly: true, sameSite: "Lax" }]);
}

async function setup(page: Page, context: BrowserContext) {
  await session(context);
  const requests: Record<string, unknown>[] = [];
  let current = tracks;
  let previous = tracks;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/playlists") return route.fulfill({ json: { playlists } });
    if (path.endsWith("/tracks")) return route.fulfill({ json: { id: "playlist-0", name: playlists[0].name, snapshotId: "snapshot", tracks: current } });
    if (path.endsWith("/reorder")) {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (body.action === "undo") {
        const order = previous.map((track) => current.findIndex((value) => value.id === track.id));
        current = previous;
        return route.fulfill({ json: { snapshotId: "snapshot", order, opCount: 1 } });
      }
      const plan = planMoves(current.length, body.commands as PlaylistEdit[]);
      previous = current;
      current = plan.newOrder.map((index) => current[index]);
      return route.fulfill({ json: { order: plan.newOrder, snapshotId: "snapshot-after", opCount: 1, undoToken: "mock-receipt", removedIndices: [] } });
    }
    return route.fulfill({ status: 501, json: { error: "Unexpected test API request" } });
  });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  return requests;
}

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const pane = page.locator('main[aria-label="Open playlist"]:visible, aside[aria-label="Playlist library"]:visible, aside[aria-label="Edit songs"]:visible');
  for (const box of await pane.all()) {
    const bounds = await box.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  }
}

test("login fits the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "TrackShift" })).toBeVisible();
  await fitsViewport(page);

  const button = await page.getByRole("button", { name: "Continue with Spotify" }).boundingBox();
  expect(button!.x).toBeGreaterThanOrEqual(0);
  expect(button!.x + button!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("mobile selects groups, filters, searches destinations, batches and undoes", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Touch navigation tested below desktop breakpoint");
  const requests = await setup(page, context);
  await expect(page.getByRole("navigation", { name: "Workspace views" })).toBeVisible();
  await fitsViewport(page);
  // Library scroll is independent from the page and works on long libraries.
  const library = page.getByRole("complementary", { name: "Playlist library" }).locator("ul");
  expect(await library.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.getByRole("button", { name: new RegExp(playlists[0].name) }).click();
  await expect(page.getByRole("button", { name: "Select #1 Song 1", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your Library" })).not.toBeVisible();
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath("tracks.png"), scale: "css" });

  await page.getByRole("button", { name: "Select #1 Song 1", exact: true }).tap();
  await page.getByRole("button", { name: "Select #3 Song 3", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Edit (2)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Deselect #1 Song 1", exact: true }).tap();
  await page.getByRole("button", { name: "Edit (1)", exact: true }).click();
  await page.getByRole("button", { name: "Undo selection", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Edit songs" }).getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "After a song…", exact: true }).click();
  await page.getByRole("textbox", { name: "Search destination songs" }).fill("Song 100");
  await page.getByRole("button", { name: /100 Song 100/ }).click();
  await expect(page.getByText("1 pending change", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath("edit.png"), scale: "css" });

  await page.getByRole("button", { name: "Tracks", exact: true }).click();
  const list = page.locator('[aria-label="Playlist tracks"]');
  expect(await list.evaluate((el) => el.clientHeight)).toBeGreaterThan(100);
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByRole("button", { name: /Select #120 Song 120/ })).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("textbox", { name: "Filter by release year or range" }).fill("2015");
  await page.getByRole("textbox", { name: "Filter by artist", exact: true }).fill("Test Artist");
  await page.getByRole("textbox", { name: "Filter by album", exact: true }).fill("Test Album");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select all 60 matches" })).toBeVisible();
  await page.getByRole("button", { name: "Select all 60 matches" }).click();
  await page.getByRole("button", { name: "Edit (60)", exact: true }).click();
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await expect(page.getByText("2 pending changes", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Apply all changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply all changes", exact: true })).not.toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].commands).toHaveLength(2);

  await page.getByRole("button", { name: "Tracks", exact: true }).click();
  await page.getByRole("button", { name: "Undo Move", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo Move", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(2);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await list.evaluate((el) => { el.scrollTop = 0; });
  await page.getByRole("button", { name: "Select #1 Song 1", exact: true }).click();
  await page.getByRole("button", { name: "Edit (1)", exact: true }).click();
  await page.getByRole("button", { name: "Remove selected from playlist (1)", exact: true }).click();
  await expect(page.getByText("1 song to remove from this playlist", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo pending change", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply all changes", exact: true })).not.toBeVisible();
  await fitsViewport(page);
  // Rotation must keep both the track viewport and the editing controls usable.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "Tracks", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select #1 Song 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select #1 Song 1", exact: true }).tap();
  expect(await list.evaluate((el) => el.clientHeight)).toBeGreaterThan(56);
  await fitsViewport(page);
});

test("desktop retains independent panels and keyboard selection", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await setup(page, context);
  await expect(page.getByRole("navigation", { name: "Workspace views" })).not.toBeVisible();
  await page.getByRole("button", { name: new RegExp(playlists[0].name) }).click();
  await page.getByRole("button", { name: "Select #1 Song 1", exact: true }).click();
  await page.getByRole("button", { name: "Select #3 Song 3", exact: true }).click({ modifiers: ["Control"] });
  await expect(page.getByRole("complementary", { name: "Edit songs" }).getByText("2 selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Move songs" })).toBeVisible();
  await fitsViewport(page);
  await page.getByRole("button", { name: "Deselect #1 Song 1", exact: true }).dragTo(page.getByRole("button", { name: "Select #5 Song 5", exact: true }));
  await expect(page.getByText("1 pending change", { exact: true })).toBeVisible();
});
