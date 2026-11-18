import type {
  CallTurn,
  FallbackCause,
  LinePicker,
  ScriptConfig,
  SessionState,
  TurnBase,
  TurnInput,
} from "../types/index.ts";
import { PickerError } from "../types/index.ts";

const RECENT_TURN_LIMIT = 6;
const MS_PER_MINUTE = 60_000;

export function allowedLineIds(script: ScriptConfig, state: SessionState): string[] {
  const lineIds = script.lines.filter((line) => line.stage === state.stage).map((line) => line.id);
  const objectionIds = script.objections
    .filter(
      (objection) =>
        !state.usedObjections.includes(objection.id) &&
        objection.allowedStages.includes(state.stage),
    )
    .map((objection) => objection.id);
  return [...lineIds, ...objectionIds];
}

export function applyLine(
  script: ScriptConfig,
  state: SessionState,
  lineId: string,
  turnBase: TurnBase,
): SessionState {
  if (!allowedLineIds(script, state).includes(lineId)) {
    throw new Error(`line "${lineId}" is not allowed in stage ${state.stage}`);
  }

  const line = script.lines.find((candidate) => candidate.id === lineId);
  if (line) {
    const turn: CallTurn = { ...turnBase, prospect: { lineId: line.id, text: line.text } };
    const next: SessionState = { ...state, turns: [...state.turns, turn] };
    if (line.endsCall) {
      next.endReason = line.endsCall;
    } else {
      next.stage = line.nextStage;
    }
    return next;
  }

  const objection = script.objections.find((candidate) => candidate.id === lineId);
  if (!objection) {
    throw new Error(`line "${lineId}" is not in the script`);
  }
  const turn: CallTurn = {
    ...turnBase,
    prospect: {
      lineId: objection.id,
      text: objection.prospectLine,
      callerReply: objection.callerReply,
    },
  };
  return {
    ...state,
    usedObjections: [...state.usedObjections, objection.id],
    turns: [...state.turns, turn],
  };
}

export function applyFallback(
  script: ScriptConfig,
  state: SessionState,
  cause: FallbackCause,
  turnBase: TurnBase,
): SessionState {
  const turn: CallTurn = {
    ...turnBase,
    fallbackCause: cause,
    prospect: { lineId: null, text: script.fallbackLine.text },
  };
  return { ...state, turns: [...state.turns, turn] };
}

export function limitPassed(state: SessionState, maxCallMinutes: number, now: Date): boolean {
  return now.getTime() - Date.parse(state.startedAt) > maxCallMinutes * MS_PER_MINUTE;
}

export async function turnStep(
  script: ScriptConfig,
  maxCallMinutes: number,
  state: SessionState,
  input: TurnInput,
  clientMs: number,
  picker: LinePicker,
  now: Date,
): Promise<{ state: SessionState; displayText: string; ended: boolean }> {
  if (limitPassed(state, maxCallMinutes, now)) {
    return { state: { ...state, endReason: "limit_reached" }, displayText: "", ended: true };
  }

  const finish = (next: SessionState) => ({
    state: next,
    displayText: next.turns[next.turns.length - 1]?.prospect.text ?? "",
    ended: next.endReason !== undefined,
  });
  const base = (candidateText: string): TurnBase => ({
    index: state.turns.length,
    clientMs,
    candidateText,
  });

  if ("sttError" in input) {
    return finish(applyFallback(script, state, input.sttError, base("")));
  }
  if (input.text.trim() === "") {
    return finish(applyFallback(script, state, "empty", base("")));
  }

  const allowedIds = allowedLineIds(script, state);
  const allowed = allowedIds.map((id) => ({
    id,
    text:
      script.lines.find((line) => line.id === id)?.text ??
      script.objections.find((objection) => objection.id === id)?.prospectLine ??
      "",
  }));

  let pickedId: unknown;
  try {
    const picked = await picker.pick({
      stage: state.stage,
      recentTurns: state.turns.slice(-RECENT_TURN_LIMIT),
      candidateText: input.text,
      allowed,
    });
    pickedId = picked?.lineId;
  } catch (error) {
    const cause = error instanceof PickerError ? error.kind : "picker_error";
    return finish(applyFallback(script, state, cause, base(input.text)));
  }

  if (typeof pickedId === "string" && allowedIds.includes(pickedId)) {
    return finish(applyLine(script, state, pickedId, base(input.text)));
  }
  return finish(applyFallback(script, state, "picker_invalid_id", base(input.text)));
}
