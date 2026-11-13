"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { planMove, planMoves } from "@/lib/reorder";
import { emptyFilters, filterTrackIndices, parseYears } from "@/lib/track-filters";
import { emptySelection, selectionReducer } from "@/lib/selection";
import type { Destination, MoveCommand, PlaylistEdit } from "@/types/move-command";
import { removalUris } from "@/lib/playlist-removal";
import type { PlaylistSummary, PlaylistTrack } from "@/types/spotify";
import { SearchIcon, TrackShiftLogo, XIcon } from "./icons";
import MovePanel from "./move-panel";
import PlaylistSidebar from "./playlist-sidebar";
import TrackList from "./track-list";

interface PlaylistData {
  id: string;
  name: string;
  snapshotId: string;
  tracks: PlaylistTrack[];
}

interface Preview {
  commands: PlaylistEdit[];
  newOrder: number[];
}

interface Toast {
  kind: "success" | "error" | "info";
  text: string;
}

interface ToolPageProps {
  userName: string;
  signOutAction: () => Promise<void>;
}

export default function ToolPage({ userName, signOutAction }: ToolPageProps) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] =
    useState<PlaylistSummary | null>(null);
  const [data, setData] = useState<PlaylistData | null>(null);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [mobilePane, setMobilePane] = useState<"library" | "tracks" | "edit">("library");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [selectionState, dispatchSelection] = useReducer(selectionReducer, emptySelection);
  const selection = useMemo(() => new Set(selectionState.indices), [selectionState.indices]);
  const lastClicked = selectionState.anchor;
  const [query, setQuery] = useState("");
  const [metadata, setMetadata] = useState({ artist: "", album: "", year: "" });
  const filtered = Boolean(query.trim() || metadata.artist.trim() || metadata.album.trim() || metadata.year.trim());
  const invalidYear = Boolean(metadata.year.trim() && !parseYears(metadata.year));

  const [preview, setPreview] = useState<Preview | null>(null);
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [lastMove, setLastMove] = useState<{ token: string; playlistId: string; name: string; snapshotId: string; removedTracks?: PlaylistTrack[] } | null>(null);
  const mutationLock = useRef(false);
  const loadVersion = useRef(0);

  // ---- data loading -------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/playlists");
        if (res.status === 401) {
          window.location.href = "/";
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load playlists");
        if (!cancelled) setPlaylists(body.playlists);
      } catch (err) {
        if (!cancelled) {
          setPlaylists([]);
          setToast({
            kind: "error",
            text: err instanceof Error ? err.message : "Failed to load playlists",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadTracks = useCallback(async (playlistId: string, preserveFilters = false) => {
    const version = ++loadVersion.current;
    setLoadingTracks(true);
    setData(null);
    dispatchSelection({ type: "reset" });
    setPreview(null);
    if (!preserveFilters) {
      setQuery("");
      setMetadata({ artist: "", album: "", year: "" });
    }
    try {
      const res = await fetch(`/api/playlists/${playlistId}/tracks`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/";
        return false;
      }
      const body = await res.json();
      if (version !== loadVersion.current) return false;
      if (!res.ok) throw new Error(body.error ?? "Failed to load tracks");
      setData(body);
      setLastMove((current) => current?.playlistId === playlistId && current.snapshotId !== body.snapshotId ? null : current);
      return true;
    } catch (err) {
      if (version !== loadVersion.current) return false;
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to load tracks",
      });
      return false;
    } finally {
      if (version === loadVersion.current) setLoadingTracks(false);
    }
  }, []);

  const refreshFromSpotify = async () => {
    if (mutationLock.current || loadingTracks || playlists === null) return;
    if (preview && !window.confirm(`Discard ${preview.commands.length} pending change(s) and refresh from Spotify?`)) return;
    mutationLock.current = true;
    setRefreshing(true);
    dispatchSelection({ type: "reset" });
    setPreview(null);
    try {
      const response = await fetch("/api/playlists", { cache: "no-store" });
      if (response.status === 401) { window.location.href = "/"; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not refresh playlists");
      const latest = body.playlists as PlaylistSummary[];
      setPlaylists(latest);
      if (selectedPlaylist) {
        const updated = latest.find((playlist) => playlist.id === selectedPlaylist.id);
        if (!updated) {
          ++loadVersion.current;
          setSelectedPlaylist(null);
          setData(null);
          setLastMove((current) => current?.playlistId === selectedPlaylist.id ? null : current);
          setToast({ kind: "info", text: "Library refreshed. The open playlist is no longer available to edit." });
          return;
        }
        setSelectedPlaylist(updated);
        if (!await loadTracks(updated.id, true)) return;
      }
      setToast({ kind: "success", text: selectedPlaylist ? "Playlist and library refreshed from Spotify" : "Library refreshed from Spotify" });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh from Spotify" });
    } finally {
      mutationLock.current = false;
      setRefreshing(false);
    }
  };

  const selectPlaylist = useCallback(
    (p: PlaylistSummary) => {
      if (mutationLock.current) return;
      if (preview && !window.confirm(`Discard ${preview.commands.length} pending change(s) and open another playlist?`)) return;
      setSelectedPlaylist(p);
      setMobilePane("tracks");
      setFiltersOpen(false);
      void loadTracks(p.id);
    },
    [loadTracks, preview],
  );

  // ---- toast auto-dismiss -------------------------------------------------

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- display order ------------------------------------------------------

  const workingTracks = useMemo(() => {
    if (!data) return [];
    return preview ? preview.newOrder.map((index) => data.tracks[index]) : data.tracks;
  }, [data, preview]);
  const visibleOrder = useMemo(() => filterTrackIndices(workingTracks, { ...metadata, query }), [workingTracks, query, metadata]);
  const pendingRemovals = useMemo(() => {
    if (!data || !preview) return [];
    const retained = new Set(preview.newOrder);
    return data.tracks.filter((_, index) => !retained.has(index));
  }, [data, preview]);

  const movedSet = useMemo(
    () => (preview ? new Set(preview.newOrder.flatMap((originalIndex, position) => originalIndex === position ? [] : [position])) : null),
    [preview],
  );

  // ---- selection model ----------------------------------------------------

  const handleRowClick = useCallback(
    (originalIndex: number, rowPos: number, e: React.MouseEvent) => {
      if (mutationLock.current) return;

      if (e.shiftKey && lastClicked !== null) {
        const lastPos = visibleOrder.indexOf(lastClicked);
        if (lastPos !== -1) {
          const [a, b] =
            lastPos < rowPos ? [lastPos, rowPos] : [rowPos, lastPos];
          const range = visibleOrder.slice(a, b + 1);
          dispatchSelection({ type: "change", indices: e.ctrlKey || e.metaKey ? [...selection, ...range] : range, anchor: lastClicked });
          return;
        }
      }

      // Phones and tablets have no Ctrl/Cmd key: each tap toggles a song.
      if (e.ctrlKey || e.metaKey || (e.nativeEvent as PointerEvent).pointerType === "touch" || window.matchMedia("(max-width: 1279px)").matches) {
        const next = new Set(selection);
        if (next.has(originalIndex)) next.delete(originalIndex);
        else next.add(originalIndex);
        dispatchSelection({ type: "change", indices: [...next], anchor: originalIndex });
      } else {
        dispatchSelection({ type: "change", indices: [originalIndex], anchor: originalIndex });
      }
    },
    [lastClicked, visibleOrder, selection],
  );

  const selectAllVisible = useCallback(() => {
    if (mutationLock.current) return;
    dispatchSelection({ type: "change", indices: visibleOrder, anchor: null });
  }, [visibleOrder]);

  const clearSelection = useCallback(() => {
    if (mutationLock.current) return;
    dispatchSelection({ type: "change", indices: [], anchor: null });
  }, []);

  const removeFromSelection = useCallback((index: number) => {
    if (mutationLock.current) return;
    dispatchSelection({ type: "change", indices: [...selection].filter((value) => value !== index), anchor: lastClicked === index ? null : lastClicked });
  }, [selection, lastClicked]);

  const selectIndices = useCallback(
    (indices: number[], mode: "replace" | "add") => {
      if (mutationLock.current) return;
      dispatchSelection({ type: "change", indices: mode === "add" ? [...selection, ...indices] : indices, anchor: null });
    },
    [selection],
  );

  // ---- preview & apply ----------------------------------------------------

  const buildPreview = useCallback(
    (destination: Destination, draggedIndices?: number[]) => {
      const indices = draggedIndices ?? [...selection];
      if (!data || indices.length === 0 || mutationLock.current) return;
      if ((preview?.commands.length ?? 0) >= 500) {
        setToast({ kind: "info", text: "Apply this batch before adding more moves." });
        return;
      }
      const command: MoveCommand = {
        selectedIndices: [...indices].sort((x, y) => x - y),
        destination,
      };
      try {
        const previousOrder = preview?.newOrder ?? data.tracks.map((_, index) => index);
        const plan = planMove(previousOrder.length, command);
        if (plan.ops.length === 0) {
          setToast({
            kind: "info",
            text: "Those songs are already in that position",
          });
          return;
        }
        setPreview({ commands: [...(preview?.commands ?? []), command], newOrder: plan.newOrder.map((index) => previousOrder[index]) });
        dispatchSelection({ type: "reset" });
      } catch (err) {
        setToast({
          kind: "error",
          text: err instanceof Error ? err.message : "Invalid move",
        });
      }
    },
    [data, selection, preview],
  );

  const removeSelected = () => {
    if (!data || !selection.size || mutationLock.current) return;
    if ((preview?.commands.length ?? 0) >= 500) { setToast({ kind: "info", text: "Apply this batch before adding more changes." }); return; }
    try {
      const selectedIndices = [...selection].sort((a, b) => a - b);
      removalUris(workingTracks, selectedIndices);
      const commands: PlaylistEdit[] = [...(preview?.commands ?? []), { kind: "remove", selectedIndices }];
      setPreview({ commands, newOrder: planMoves(data.tracks.length, commands).newOrder });
      dispatchSelection({ type: "reset" });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "Could not mark songs for removal" });
    }
  };

  const applyPreview = useCallback(async () => {
    if (!data || !preview || mutationLock.current) return;
    mutationLock.current = true;
    setApplying(true);
    try {
      const res = await fetch(`/api/playlists/${data.id}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands: preview.commands,
          trackCount: data.tracks.length,
          snapshotId: data.snapshotId,
        }),
      });
      if (res.status === 401) {
        window.location.href = "/";
        return;
      }
      const body = await res.json();
      if (res.status === 409) {
        setLastMove(null);
        setToast({
          kind: "error",
          text: "Playlist changed in Spotify — reloading the latest order",
        });
        await loadTracks(data.id);
        return;
      }
      if (!res.ok) {
        if (body.reloadRequired) { setLastMove(null); await loadTracks(data.id); }
        throw new Error(body.reloadRequired ? `${body.error ?? "Move failed"}. Reloaded the playlist because Spotify may have applied part of the move.` : body.error ?? "Failed to apply reorder");
      }

      // Apply the known new order locally with the authoritative snapshot
      // returned by Spotify's reorder call. Refetching immediately instead
      // can read a stale replica and cause false conflicts on the next move.
      const changeCount = preview.commands.length;
      const newOrder: number[] = body.order;
      setData((prev) =>
        prev?.id === data.id
          ? {
              ...prev,
              snapshotId: body.snapshotId,
              tracks: newOrder.map((i) => prev.tracks[i]),
            }
          : prev,
      );
      setPreview(null);
      dispatchSelection({ type: "reset" });
      if (body.undoToken) setLastMove({ token: body.undoToken, playlistId: data.id, name: data.name, snapshotId: body.snapshotId, removedTracks: ((body.removedIndices ?? []) as number[]).map((index) => data.tracks[index]) });
      setPlaylists((current) => current?.map((playlist) => playlist.id === data.id ? { ...playlist, trackCount: newOrder.length } : playlist) ?? null);
      setToast({
        kind: "success",
        text: body.opCount ? `Applied ${changeCount} change${changeCount === 1 ? "" : "s"} to Spotify${pendingRemovals.length ? `; removed ${pendingRemovals.length} song(s)` : ""}` : "The final order already matches Spotify. No changes needed.",
      });
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to apply reorder",
      });
    } finally {
      mutationLock.current = false;
      setApplying(false);
    }
  }, [data, preview, loadTracks, pendingRemovals.length]);

  const cancelPreview = useCallback(() => {
    if (mutationLock.current) return;
    setPreview(null);
    dispatchSelection({ type: "reset" });
  }, []);

  const undoPendingMove = () => {
    if (!data || !preview || mutationLock.current) return;
    const commands = preview.commands.slice(0, -1);
    setPreview(commands.length ? { commands, newOrder: planMoves(data.tracks.length, commands).newOrder } : null);
    dispatchSelection({ type: "reset" });
  };

  const undoMove = async () => {
    if (!data || !lastMove || lastMove.playlistId !== data.id || mutationLock.current) return;
    mutationLock.current = true;
    setApplying(true);
    try {
      const response = await fetch(`/api/playlists/${data.id}/reorder`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", undoToken: lastMove.token }),
      });
      if (response.status === 401) { window.location.href = "/"; return; }
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409 || body.reloadRequired) { setLastMove(null); await loadTracks(data.id); }
        throw new Error(body.error ?? "Could not undo the move");
      }
      setData((current) => {
        if (current?.id !== data.id) return current;
        const available = [...current.tracks, ...(lastMove.removedTracks ?? [])];
        return { ...current, snapshotId: body.snapshotId, tracks: (body.order as number[]).map((index) => available[index]) };
      });
      setPlaylists((current) => current?.map((playlist) => playlist.id === data.id ? { ...playlist, trackCount: body.order.length } : playlist) ?? null);
      setLastMove(null);
      dispatchSelection({ type: "reset" });
      setPreview(null);
      setToast({ kind: "success", text: lastMove.removedTracks?.length ? "Last changes undone; removed songs restored on Spotify" : "Last move undone on Spotify" });
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "Could not undo the move" });
    } finally {
      mutationLock.current = false;
      setApplying(false);
    }
  };

  // ---- render -------------------------------------------------------------

  return (
    <div className="workspace relative flex h-dvh min-h-0 flex-col overflow-hidden bg-black">
      {/* Header */}
      <header className="workspace-header flex h-14 shrink-0 items-center gap-3 px-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-spotify text-black">
            <TrackShiftLogo className="h-5 w-5" />
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            TrackShift
          </span>
        </span>

        <span className="flex-1" />

        <span className="hidden max-w-40 truncate text-sm text-subtle md:block">
          {userName}
        </span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/20"
          >
            Log out
          </button>
        </form>
      </header>

      <nav aria-label="Workspace views" className="workspace-nav mx-2 mb-2 grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-elevated p-1 xl:hidden">
        {([
          ["library", "Playlists"],
          ["tracks", "Tracks"],
          ["edit", selection.size ? `Edit (${selection.size})` : preview ? `Review (${preview.commands.length})` : "Edit"],
        ] as const).map(([pane, label]) => (
          <button key={pane} type="button" aria-current={mobilePane === pane ? "page" : undefined}
            disabled={pane !== "library" && !selectedPlaylist}
            onClick={() => setMobilePane(pane)}
            className={`min-h-11 min-w-0 rounded-lg px-2 text-sm font-semibold transition disabled:opacity-35 ${mobilePane === pane ? "bg-surface text-white" : "text-subtle hover:bg-white/5"}`}>
            {label}
          </button>
        ))}
      </nav>

      {/* Three-pane body */}
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        {/* Left: library */}
        <div className={`${mobilePane === "library" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 xl:flex xl:flex-none`}>
        <PlaylistSidebar
          playlists={playlists}
          selectedId={selectedPlaylist?.id ?? null}
          onSelect={selectPlaylist}
          disabled={applying || refreshing}
        />
        </div>

        {/* Center: track list */}
        <main aria-label="Open playlist" className={`${mobilePane === "tracks" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col rounded-lg bg-gradient-to-b from-elevated to-canvas xl:flex`}>
          {selectedPlaylist && (
            <div className="playlist-header flex shrink-0 flex-wrap items-start justify-between gap-2 px-4 pb-2 pt-3 sm:px-6 xl:gap-4 xl:pb-4 xl:pt-5">
              <div className="playlist-heading min-w-0 max-w-full flex-1 basis-full xl:basis-auto">
                <p className="playlist-kicker text-xs font-semibold uppercase tracking-widest text-subtle">
                  <span className="xl:hidden">{preview ? "Unsaved changes" : "Playlist"}</span>
                  <span className="hidden xl:inline">{preview ? "Working preview — not saved to Spotify" : "Playlist"}</span>
                </p>
                <h1 className="truncate text-2xl font-extrabold tracking-tight xl:text-3xl">{data?.name ?? selectedPlaylist.name}</h1>
                {data && <p className="mt-1 text-sm text-subtle">{workingTracks.length} songs{pendingRemovals.length ? ` · ${pendingRemovals.length} to remove` : ""}</p>}
              </div>
              <div className="playlist-actions flex shrink-0 items-center gap-2" role="group" aria-label="Playlist actions">
                <button type="button" onClick={() => void refreshFromSpotify()} disabled={refreshing || applying || loadingTracks || playlists === null}
                  aria-busy={refreshing} title="Reload this playlist and your library from Spotify. Clears the current selection and preview."
                  className="min-h-11 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 xl:min-h-0">
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
                <button type="button" onClick={() => void undoMove()} disabled={!lastMove || lastMove.playlistId !== data?.id || applying || refreshing || Boolean(preview) || loadingTracks}
                  title={lastMove ? `Undo the last applied changes in ${lastMove.name}. Open that playlist to undo.` : "Undo the last applied changes. Available until the next applied batch in this visit."}
                  className="min-h-11 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 xl:min-h-0">
                  {lastMove?.removedTracks?.length ? "Undo changes" : "Undo Move"}
                </button>
              </div>
            </div>
          )}
          {!selectedPlaylist && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface">
                <TrackShiftLogo className="h-8 w-8 text-spotify" />
              </span>
              <p className="text-xl font-bold">Pick a playlist to get started</p>
              <p className="max-w-sm text-sm text-subtle">
                Choose a playlist from your library, select the songs you want
                to move, and use the panel on the right to rearrange them.
              </p>
            </div>
          )}

          {selectedPlaylist && loadingTracks && (
            <div className="flex flex-1 items-center justify-center">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-spotify" />
            </div>
          )}

          {selectedPlaylist && !loadingTracks && data && (
            <>
              <div className="shrink-0 px-4 pb-3 sm:px-6">
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    {filtered && visibleOrder.length > 0 && (
                      <button
                        type="button"
                        onClick={selectAllVisible}
                        className="whitespace-nowrap rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
                      >
                        Select all {visibleOrder.length} matches
                      </button>
                    )}
                    <div className="order-first flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-4 py-2 ring-1 ring-transparent focus-within:ring-white/30 xl:order-none xl:flex-none">
                      <SearchIcon className="h-4 w-4 shrink-0 text-subtle" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search this playlist"
                        aria-label="Search this playlist"
                        className="min-w-0 w-full bg-transparent text-base outline-none placeholder:text-subtle/60 xl:w-44 xl:text-sm"
                      />
                      {query !== "" && (
                        <button
                          type="button"
                          onClick={() => setQuery("")}
                          aria-label="Clear playlist search"
                          className="text-subtle transition hover:text-white"
                        >
                          <XIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <button type="button" aria-expanded={filtersOpen} aria-controls="metadata-filters" onClick={() => setFiltersOpen((open) => !open)}
                      className={`min-h-11 rounded-full px-4 text-sm font-semibold xl:hidden ${filtersOpen || metadata.artist || metadata.album || metadata.year ? "bg-spotify/20 text-spotify-bright" : "bg-white/10"}`}>
                      Filters
                    </button>
                </div>
              </div>

              <div id="metadata-filters" className={`${filtersOpen ? "block" : "hidden"} max-h-[35dvh] shrink-0 overflow-y-auto px-4 pb-4 sm:px-6 xl:block xl:max-h-none`}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <label className="min-w-0 text-xs text-subtle">Artist
                      <input aria-label="Filter by artist" value={metadata.artist} onChange={(event) => setMetadata((current) => ({ ...current, artist: event.target.value }))}
                        placeholder="Any artist" className="mt-1 w-full rounded-md bg-surface px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/30" />
                    </label>
                    <label className="min-w-0 text-xs text-subtle">Album
                      <input aria-label="Filter by album" value={metadata.album} onChange={(event) => setMetadata((current) => ({ ...current, album: event.target.value }))}
                        placeholder="Any album" className="mt-1 w-full rounded-md bg-surface px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/30" />
                    </label>
                    <label className="col-span-2 min-w-0 text-xs text-subtle sm:col-span-1">Release year
                      <input aria-label="Filter by release year or range" aria-invalid={invalidYear} aria-describedby={invalidYear ? "year-filter-error" : undefined}
                        value={metadata.year} onChange={(event) => setMetadata((current) => ({ ...current, year: event.target.value }))}
                        placeholder="2015 or 2015-2018" className="mt-1 w-full rounded-md bg-surface px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/30" />
                    </label>
                  </div>
                  {invalidYear && <p id="year-filter-error" role="status" className="mt-2 text-xs text-red-300">Enter a four-digit year or an ascending range, such as 2015-2018.</p>}
                  {filtered && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-subtle">
                    <span>{visibleOrder.length} of {workingTracks.length} tracks match · {preview ? "working" : "playlist"} positions shown</span>
                    <button type="button" onClick={() => { setQuery(emptyFilters.query); setMetadata({ artist: "", album: "", year: "" }); }} className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Clear filters</button>
                  </div>}
              </div>

              <div className="selection-toolbar flex shrink-0 items-center justify-between gap-2 px-4 pb-2 text-xs text-subtle xl:hidden">
                <span>{selection.size ? `${selection.size} selected` : "Tap songs to select"}{filtered ? ` · ${visibleOrder.length} matches` : ""}</span>
                {selection.size > 0 && <button type="button" onClick={clearSelection} disabled={applying || refreshing} className="min-h-9 px-2 font-semibold text-white">Clear selection</button>}
              </div>

              <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 sm:px-4">
                {visibleOrder.length === 0 ? (
                  <p className="mt-16 text-center text-sm text-subtle">
                    {pendingRemovals.length > 0 && workingTracks.length === 0 ? "All songs are marked for removal. Undo a pending change or apply the batch." : "No tracks match the current search and filters."}
                  </p>
                ) : (
                  <TrackList
                    tracks={workingTracks}
                    order={visibleOrder}
                    selection={selection}
                    movedSet={movedSet}
                    sourceOrder={preview?.newOrder}
                    metadataHighlights={{ artist: Boolean(metadata.artist.trim()), album: Boolean(metadata.album.trim()), year: Boolean(metadata.year.trim()) }}
                    onRowClick={handleRowClick}
                    disabled={applying || refreshing}
                    onDropTracks={(command) => buildPreview(command.destination, command.selectedIndices)}
                  />
                )}
              </div>
            </>
          )}
          {(selection.size > 0 || preview) && <div className="mobile-edit-shortcut shrink-0 border-t border-white/10 p-3 xl:hidden">
            <button type="button" onClick={() => setMobilePane("edit")} className="min-h-11 w-full rounded-full bg-spotify px-4 py-3 text-sm font-bold text-black">
              {selection.size ? `Move or remove ${selection.size} song${selection.size === 1 ? "" : "s"}` : `Review ${preview?.commands.length} pending change${preview?.commands.length === 1 ? "" : "s"}`}
            </button>
          </div>}
        </main>

        {/* Right: move panel */}
        <div className={`${mobilePane === "edit" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 xl:flex xl:flex-none`}>
        <MovePanel
          key={`${data?.id ?? "none"}:${data?.snapshotId ?? "none"}:${preview?.commands.length ?? 0}`}
          tracks={data ? workingTracks : null}
          selection={selection}
          preview={preview}
          applying={applying || refreshing}
          onMove={buildPreview}
          onRemove={removeFromSelection}
          onClear={clearSelection}
          onApply={applyPreview}
          onCancelPreview={cancelPreview}
          onUndoPendingMove={undoPendingMove}
          onRemoveSelected={removeSelected}
          pendingRemovals={pendingRemovals}
          onSelectIndices={selectIndices}
          canUndoSelection={selectionState.previous !== null}
          onUndoSelection={() => { if (!mutationLock.current) dispatchSelection({ type: "undo" }); }}
        />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-50 flex justify-center px-4 xl:bottom-auto xl:top-16">
          <div
            role={toast.kind === "error" ? "alert" : "status"}
            className={`max-w-lg break-words rounded-xl px-5 py-2.5 text-sm font-semibold shadow-xl shadow-black/50 ${
              toast.kind === "success"
                ? "bg-spotify text-black"
                : toast.kind === "error"
                  ? "bg-red-500 text-white"
                  : "bg-surface text-white ring-1 ring-white/20"
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
