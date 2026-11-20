import type { CallTurn, FallbackCause, ScriptConfig, SessionState } from "../types/index.ts";

/**
 * Practice calls are never stored. The page holds this state and sends it back with each turn,
 * so the server stays stateless and nothing about a practice call reaches storage.
 */
export interface PracticeState {
  stage: SessionState["stage"];
  usedObjections: string[];
  turns: CallTurn[];
  startedAt: string;
  endReason?: SessionState["endReason"];
}

const MAX_TURNS = 500;
const MAX_TEXT = 5000;
const CAUSES: readonly FallbackCause[] = [
  "stt_error",
  "stt_timeout",
  "empty",
  "picker_error",
  "picker_timeout",
  "picker_refusal",
  "picker_invalid_id",
];

export function freshPractice(script: ScriptConfig, now: Date): PracticeState {
  return {
    stage: script.stages[0] ?? "d1_attention",
    usedObjections: [],
    turns: [],
    startedAt: now.toISOString(),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shortText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_TEXT;

function parseTurn(value: unknown, index: number, knownIds: Set<string>): CallTurn | null {
  if (!isRecord(value) || value.index !== index) return null;
  const { clientMs, candidateText, fallbackCause, prospect } = value;
  if (typeof clientMs !== "number" || !Number.isFinite(clientMs) || clientMs < 0) return null;
  if (!shortText(candidateText) || !isRecord(prospect) || !shortText(prospect.text)) return null;
  const lineId = prospect.lineId;
  if (lineId !== null && !(typeof lineId === "string" && knownIds.has(lineId))) return null;
  const turn: CallTurn = {
    index,
    clientMs,
    candidateText,
    prospect: { lineId, text: prospect.text },
  };
  if (fallbackCause !== undefined) {
    if (!CAUSES.includes(fallbackCause as FallbackCause)) return null;
    turn.fallbackCause = fallbackCause as FallbackCause;
  }
  return turn;
}

/** The state the page sent, checked field by field, or null when anything is off. */
export function parsePracticeState(raw: unknown, script: ScriptConfig): PracticeState | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const { stage, usedObjections, turns, startedAt, endReason } = value;
  if (!script.stages.includes(stage as SessionState["stage"])) return null;
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) return null;

  const objectionIds = new Set(script.objections.map((objection) => objection.id));
  if (!Array.isArray(usedObjections)) return null;
  if (!usedObjections.every((id) => typeof id === "string" && objectionIds.has(id))) return null;
  if (new Set(usedObjections).size !== usedObjections.length) return null;

  const knownIds = new Set([...script.lines.map((line) => line.id), ...objectionIds]);
  if (!Array.isArray(turns) || turns.length > MAX_TURNS) return null;
  const parsed: CallTurn[] = [];
  for (const [index, turn] of turns.entries()) {
    const ok = parseTurn(turn, index, knownIds);
    if (!ok) return null;
    parsed.push(ok);
  }

  const state: PracticeState = {
    stage: stage as SessionState["stage"],
    usedObjections: [...(usedObjections as string[])],
    turns: parsed,
    startedAt,
  };
  if (endReason !== undefined) {
    const reasons = ["booked", "prospect_ended", "limit_reached", "candidate_ended"];
    if (!reasons.includes(endReason as string)) return null;
    state.endReason = endReason as SessionState["endReason"];
  }
  return state;
}

export function asSession(state: PracticeState): SessionState {
  return { id: "practice", name: "practice", ...state };
}

/** What goes back to the page: the session fields minus caller replies (D1). */
export function toPractice(session: SessionState): PracticeState {
  const state: PracticeState = {
    stage: session.stage,
    usedObjections: session.usedObjections,
    turns: session.turns.map((turn) => {
      const { callerReply: _hidden, ...prospect } = turn.prospect;
      return { ...turn, prospect };
    }),
    startedAt: session.startedAt,
  };
  if (session.endReason !== undefined) state.endReason = session.endReason;
  return state;
}
