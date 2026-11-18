import { describe, expect, it } from "vitest";
import type { CallTurn, FallbackCause, Transcript } from "../src/types/index.ts";
import { checkSession, normalizeMarker, percentile } from "./load-check.ts";

function turn(index: number, candidateText: string, fallbackCause?: FallbackCause): CallTurn {
  const prospect = { lineId: null, text: "reply" };
  return fallbackCause === undefined
    ? { index, clientMs: index * 1000, candidateText, prospect }
    : { index, clientMs: index * 1000, candidateText, fallbackCause, prospect };
}

function transcript(turns: CallTurn[]): Transcript {
  return {
    id: "s",
    name: "load-test-1",
    startedAt: "2026-01-01T10:00:00.000Z",
    endedAt: "2026-01-01T10:05:00.000Z",
    endReason: "candidate_ended",
    turns,
  };
}

describe("checkSession", () => {
  it("reports nothing for a clean session", () => {
    const t = transcript([turn(0, "marker-1"), turn(1, "marker-1")]);
    expect(checkSession("marker-1", ["marker-2", "marker-3"], t)).toEqual([]);
  });

  it("reports a missing own marker", () => {
    const t = transcript([turn(0, "something else")]);
    const problems = checkSession("marker-1", ["marker-2"], t);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("marker-1");
    expect(problems[0]).toContain("missing");
  });

  it("reports a transcript with no turns as missing the marker", () => {
    expect(checkSession("marker-1", [], transcript([]))).toHaveLength(1);
  });

  it("matches ignoring case and punctuation, as a transcriber would write it", () => {
    expect(checkSession("banana", [], transcript([turn(0, "Banana.")]))).toEqual([]);
    expect(checkSession("marker-4", [], transcript([turn(0, "  MARKER-4! ")]))).toEqual([]);
  });

  it("does not count a marker that is only part of a longer text", () => {
    const own = transcript([turn(0, "marker-1 and then more")]);
    expect(checkSession("marker-1", [], own)).toHaveLength(1);
    const other = transcript([turn(0, "marker-1"), turn(1, "not marker-2 at all")]);
    expect(checkSession("marker-1", ["marker-2"], other)).toEqual([]);
  });

  it("reports another session's marker, once per marker", () => {
    const t = transcript([turn(0, "marker-1"), turn(1, "marker-2"), turn(2, "marker-2")]);
    const problems = checkSession("marker-1", ["marker-2", "marker-3"], t);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("marker-2");
    expect(problems[0]).toContain("another session");
  });

  it("reports a fallback for each vendor cause", () => {
    const vendor: FallbackCause[] = [
      "stt_error",
      "stt_timeout",
      "picker_error",
      "picker_timeout",
      "picker_refusal",
    ];
    for (const cause of vendor) {
      const t = transcript([turn(0, "marker-1"), turn(1, "marker-1", cause)]);
      const problems = checkSession("marker-1", [], t);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(cause);
      expect(problems[0]).toContain("turn 1");
    }
  });

  it("does not treat empty or invalid-id fallbacks as vendor problems", () => {
    const t = transcript([
      turn(0, "marker-1"),
      turn(1, "", "empty"),
      turn(2, "marker-1", "picker_invalid_id"),
    ]);
    expect(checkSession("marker-1", [], t)).toEqual([]);
  });

  it("lists every kind of problem together", () => {
    const t = transcript([turn(0, "marker-2", "stt_error")]);
    expect(checkSession("marker-1", ["marker-2"], t)).toHaveLength(3);
  });

  it("never counts an empty marker as present, even against not-understood turns", () => {
    const t = transcript([turn(0, "", "empty")]);
    expect(checkSession("", [], t)).toHaveLength(1);
    const withSilence = transcript([turn(0, "marker-1"), turn(1, "")]);
    expect(checkSession("marker-1", ["!!!"], withSilence)).toEqual([]);
  });
});

describe("normalizeMarker", () => {
  it("lowercases, strips punctuation and symbols, and collapses whitespace", () => {
    expect(normalizeMarker("  Hello,   WORLD! ")).toBe("hello world");
    expect(normalizeMarker("marker-12")).toBe("marker12");
    expect(normalizeMarker("a+b")).toBe("ab");
  });
});

describe("percentile", () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns the nearest-rank value", () => {
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 90)).toBe(9);
    expect(percentile(ten, 95)).toBe(10);
    expect(percentile(ten, 10)).toBe(1);
    expect(percentile(ten, 11)).toBe(2);
  });

  it("returns the extremes at 0 and 100", () => {
    expect(percentile(ten, 0)).toBe(1);
    expect(percentile(ten, 100)).toBe(10);
  });

  it("sorts its input and leaves it untouched", () => {
    const values = [30, 10, 20];
    expect(percentile(values, 50)).toBe(20);
    expect(percentile(values, 100)).toBe(30);
    expect(values).toEqual([30, 10, 20]);
  });

  it("returns the only value of a single-value list for any p", () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 100)).toBe(7);
  });

  it("returns an observed value for the 95th percentile of 20 values", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(twenty, 95)).toBe(19);
  });

  it("rejects an empty list and a p outside 0 to 100", () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => percentile(ten, -1)).toThrow(RangeError);
    expect(() => percentile(ten, 101)).toThrow(RangeError);
    expect(() => percentile(ten, Number.NaN)).toThrow(RangeError);
  });
});
