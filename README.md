# Trackshift

Arrange your Spotify playlists without losing track of what changed. Filter by artist, album, or release year, select a song or a scattered group, and move tracks with drag-and-drop or precise placement controls. Build a batch of moves and removals, review the working order, then apply everything to Spotify once.

**Live app:** [trackshift-delta.vercel.app](https://trackshift-delta.vercel.app)

## How it works

```
Spotify sign-in
   └─► choose an editable playlist
   └─► filter and select songs
   └─► stage moves or removals — keep editing the working preview
   └─► apply all changes to Spotify
   └─► undo the last applied batch if the playlist is still unchanged
```

- **Selection:** single songs, Shift-click ranges, Ctrl/Cmd-click groups, and all filtered matches. Groups keep their playlist order.
- **Phones and tablets:** switch between Playlists, Tracks, and Edit. Tap songs to toggle a multi-selection, open Filters for metadata, and use Edit for placement, removal, and batch confirmation. Desktop keeps the three-panel layout and drag-and-drop.
- **Placement:** top, bottom, before/after a searchable track, or an exact position. Dragging works with filtered results too.
- **Metadata:** combine artist, album, and release-year filters; use a year such as `2015` or a range such as `2015-2018`.
- **Batch editing:** undo a selection, undo pending changes, or discard the whole batch before applying.
- **Removal:** review songs marked for removal before applying. Duplicate songs require selecting every copy; local files and unavailable songs are blocked.
- **Refresh and undo:** reload changes made in Spotify; undo the latest applied batch while its Spotify snapshot still matches. Restoring removed songs re-adds them and restores their order.
- **Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, Auth.js, TanStack Virtual, and Vitest.
- **Storage:** no application database. Drafts and restore data stay in memory for the current visit; authentication uses encrypted HttpOnly cookies. Refreshing the browser or closing the visit clears pending work.

## Run locally

Create an application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and register this exact redirect URI:

```text
http://127.0.0.1:3000/api/auth/callback/spotify
```

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
# Fill in the Spotify credentials and AUTH_SECRET in .env.local.
npm.cmd run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Use this address and port consistently with the registered callback. On other shells, use `npm` instead of `npm.cmd`.

## Deploy on Vercel

1. Import your GitHub repository into Vercel. To connect an existing CLI deployment, use that project's **Settings → Git → Connect Git Repository** instead of creating another project.
2. Add the production environment variables below. Keep credentials out of GitHub.
3. Deploy and copy the stable HTTPS production domain.
4. Set `AUTH_URL` to that origin and register `https://YOUR-DOMAIN/api/auth/callback/spotify` in the Spotify dashboard. Keep the local callback if you continue local development.
5. Redeploy after updating environment variables. Use the stable domain for sign-in; preview deployments need their own authentication setup.

The live Trackshift project uses [trackshift-delta.vercel.app](https://trackshift-delta.vercel.app) and deploys automatically from this repository's `master` branch. Production credentials stay in the existing Vercel project's environment settings. Forks should use their own Spotify application and credentials.

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SPOTIFY_ID` | Yes | Spotify application Client ID |
| `AUTH_SPOTIFY_SECRET` | Yes | Spotify application Client Secret; server only |
| `AUTH_SECRET` | Yes | Cryptographically random secret of at least 32 characters; use separate values locally and in production |
| `AUTH_URL` | Production | Stable HTTPS origin, e.g. `https://your-project.vercel.app`; leave unset locally |

Spotify permissions: `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, and `playlist-modify-private`.

Spotify's development-mode allowlist and API quotas still apply after deployment. A public website or public source repository does not grant unrestricted Spotify API access. See [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## Checks

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e
```

Tests cover ordering, batch edits, filtering, drag targets, removal safeguards, undo, snapshots, request chunking, and public session token filtering. Test requests use mocked Spotify responses. Verify real edits on a disposable playlist before relying on a deployment.

Browser checks cover 320px and 390px phones, an 820px tablet, and desktop, including rotation, scrolling, tap selection, filtering, destination search, apply, and undo. They use an isolated local test session and mocked APIs on port 3002, never real Spotify edits. On Windows they use installed Google Chrome; elsewhere run `npx playwright install chromium` first.

Trackshift is an independent tool and is not affiliated with Spotify.
