import { describe, expect, it } from "vitest";
import { emptyFilters, filterTrackIndices, parseYears } from "./track-filters";
import type { PlaylistTrack } from "@/types/spotify";

const makeTrack = (name: string, artists: string[], album: string, releaseDate: string | null): PlaylistTrack => ({ name, artists, album, releaseDate, uri: `track:${name}`, id: name, albumImageUrl: null, durationMs: 1000, isLocal: false });
const tracks = [
  makeTrack("First", ["Lead", "Guest"], "Red", "2015-01-02"),
  makeTrack("Second", ["Other"], "Blue", "2018"),
  makeTrack("Third", ["Lead"], "Red", "2020-05"),
  makeTrack("Unknown", ["Lead"], "Blue", null),
];

describe("metadata filters", () => {
  it("matches any credited artist, case-insensitively", () => {
    expect(filterTrackIndices(tracks, { ...emptyFilters, artist: " guest " })).toEqual([0]);
  });
  it("filters albums while retaining original playlist indices", () => {
    expect(filterTrackIndices(tracks, { ...emptyFilters, album: "BLUE" })).toEqual([1, 3]);
  });
  it("filters one year and inclusive ranges without matching unknown dates", () => {
    expect(filterTrackIndices(tracks, { ...emptyFilters, year: "2015" })).toEqual([0]);
    expect(filterTrackIndices(tracks, { ...emptyFilters, year: "2015-2018" })).toEqual([0, 1]);
    expect(filterTrackIndices(tracks, { ...emptyFilters, year: "2018-2020" })).toEqual([1, 2]);
  });
  it("combines search, artist, album, and year with AND", () => {
    expect(filterTrackIndices(tracks, { query: "third", artist: "lead", album: "red", year: "2015-2020" })).toEqual([2]);
    expect(filterTrackIndices(tracks, { query: "third", artist: "other", album: "red", year: "2015-2020" })).toEqual([]);
  });
  it("rejects invalid ranges and returns all indices when cleared", () => {
    expect(parseYears("2020-2015")).toBeNull();
    expect(parseYears("201")).toBeNull();
    expect(filterTrackIndices(tracks, { ...emptyFilters, year: "2015-" })).toEqual([]);
    expect(filterTrackIndices(tracks, emptyFilters)).toEqual([0, 1, 2, 3]);
  });
  it("allows a general search for release year", () => {
    expect(filterTrackIndices(tracks, { ...emptyFilters, query: "2018" })).toEqual([1]);
  });
});
