export interface PlaylistSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  ownerName: string;
}

export interface PlaylistTrack {
  uri: string;
  id: string | null;
  name: string;
  artists: string[];
  album: string;
  albumImageUrl: string | null;
  /** Album release date: "YYYY", "YYYY-MM", or "YYYY-MM-DD". */
  releaseDate: string | null;
  durationMs: number;
  isLocal: boolean;
}

export interface PlaylistDetail {
  id: string;
  name: string;
  snapshotId: string;
  tracks: PlaylistTrack[];
}
