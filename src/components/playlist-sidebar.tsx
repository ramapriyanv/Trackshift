"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { PlaylistSummary } from "@/types/spotify";
import { MusicIcon, SearchIcon } from "./icons";

interface PlaylistSidebarProps {
  playlists: PlaylistSummary[] | null;
  selectedId: string | null;
  onSelect: (playlist: PlaylistSummary) => void;
  disabled?: boolean;
}

export default function PlaylistSidebar({
  playlists,
  selectedId,
  onSelect,
  disabled,
}: PlaylistSidebarProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!playlists) return [];
    const q = query.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter((p) => p.name.toLowerCase().includes(q));
  }, [playlists, query]);

  return (
    <aside className="flex w-72 shrink-0 flex-col rounded-lg bg-elevated">
      <div className="px-4 pb-2 pt-4">
        <h2 className="text-base font-bold">Your Library</h2>
        <p className="mt-0.5 text-xs text-subtle">
          {playlists === null
            ? "Loading…"
            : `${playlists.length} editable playlists`}
        </p>
      </div>

      <div className="mx-3 mb-2 flex items-center gap-2 rounded-md bg-highlight px-3 py-2">
        <SearchIcon className="h-4 w-4 shrink-0 text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter playlists"
          className="w-full bg-transparent text-sm outline-none placeholder:text-subtle/60"
        />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {playlists !== null && filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-subtle">
            No playlists found
          </li>
        )}
        {filtered.map((p) => {
          const active = p.id === selectedId;
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(p)}
                className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition ${
                  active ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                {p.imageUrl ? (
                  <Image
                    src={p.imageUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-highlight">
                    <MusicIcon className="h-5 w-5 text-subtle" />
                  </span>
                )}
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm font-medium ${
                      active ? "text-spotify-bright" : ""
                    }`}
                  >
                    {p.name}
                  </span>
                  <span className="block truncate text-xs text-subtle">
                    Playlist · {p.trackCount} songs
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
