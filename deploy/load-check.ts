import type { Transcript } from "../src/types/index.ts";
import { VENDOR_CAUSES } from "../src/types/index.ts";

/** Lowercase, drop punctuation and symbols, collapse whitespace: how a marker is compared. */
export function normalizeMarker(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Problems found in one session's stored transcript. A marker counts as present only when a
 * turn's whole candidate text equals it, so a transcript that merely contains the word does not
 * pass.
 */
export function checkSession(
  expectedMarker: string,
  otherMarkers: readonly string[],
  transcript: Transcript,
): string[] {
  const problems: string[] = [];
  const spoken = transcript.turns.map((turn) => normalizeMarker(turn.candidateText));

  // A marker that normalizes to "" would match every not-understood turn, so it never counts.
  const heard = (marker: string) => {
    const wanted = normalizeMarker(marker);
    return wanted !== "" && spoken.includes(wanted);
  };

  if (!heard(expectedMarker)) {
    problems.push(`own marker "${expectedMarker}" missing`);
  }
  for (const other of otherMarkers) {
    if (heard(other)) {
      problems.push(`another session's marker "${other}" present`);
    }
  }
  for (const turn of transcript.turns) {
    const cause = turn.fallbackCause;
    if (cause !== undefined && VENDOR_CAUSES.includes(cause)) {
      problems.push(`turn ${turn.index} fell back: ${cause}`);
    }
  }
  return problems;
}

/** Nearest-rank percentile: the smallest value with at least p percent of the values at or below it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError("percentile of no values");
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentile ${p} is outside 0 to 100`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}
