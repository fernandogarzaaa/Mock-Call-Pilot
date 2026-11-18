import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LinePicker, TurnInput } from "../types/index.ts";
import { PickerError } from "../types/index.ts";
import { FIXTURE_START, fixtureScript, fixtureState } from "./fixture.ts";
import { limitPassed, turnStep } from "./machine.ts";

const MAX_CALL_MINUTES = 10;
const PICKER_KINDS = ["picker_error", "picker_timeout", "picker_refusal"] as const;
const STT_KINDS = ["stt_error", "stt_timeout"] as const;

type PickBehaviour =
  | { kind: "allowed"; index: number }
  | { kind: "garbage"; value: string }
  | { kind: "disallowed"; index: number }
  | { kind: "throws"; error: (typeof PICKER_KINDS)[number] };
type InputBehaviour =
  | { kind: "text"; text: string }
  | { kind: "blank" }
  | { kind: "stt"; error: (typeof STT_KINDS)[number] };

const shownTexts = new Set([
  ...fixtureScript.lines.map((line) => line.text),
  ...fixtureScript.objections.map((objection) => objection.prospectLine),
  fixtureScript.fallbackLine.text,
]);
const callerReplies = new Set(fixtureScript.objections.map((objection) => objection.callerReply));
const everyId = [
  ...fixtureScript.lines.map((line) => line.id),
  ...fixtureScript.objections.map((objection) => objection.id),
];

// 70% of picker calls return an allowed id; the rest are garbage, a disallowed id, or a throw.
const pickBehaviour: fc.Arbitrary<PickBehaviour> = fc.oneof(
  { weight: 7, arbitrary: fc.record({ kind: fc.constant("allowed" as const), index: fc.nat() }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("garbage" as const), value: fc.string() }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("disallowed" as const), index: fc.nat() }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("throws" as const),
      error: fc.constantFrom(...PICKER_KINDS),
    }),
  },
);

const inputBehaviour: fc.Arbitrary<InputBehaviour> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ kind: fc.constant("text" as const), text: fc.string() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("blank" as const) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("stt" as const),
      error: fc.constantFrom(...STT_KINDS),
    }),
  },
);

const step = fc.record({
  pick: pickBehaviour,
  input: inputBehaviour,
  seconds: fc.integer({ min: 20, max: 90 }),
});

function toTurnInput(input: InputBehaviour): TurnInput {
  if (input.kind === "text") {
    return { text: input.text };
  }
  if (input.kind === "blank") {
    return { text: "  " };
  }
  return { sttError: input.error };
}

interface PickerLog {
  called: boolean;
  threw: boolean;
  allowedIds: string[];
  allowedTexts: string[];
  returned?: string;
}

function simulatedPicker(behaviour: PickBehaviour, log: PickerLog): LinePicker {
  return {
    async pick(input) {
      log.called = true;
      log.allowedIds = input.allowed.map((entry) => entry.id);
      log.allowedTexts = input.allowed.map((entry) => entry.text);
      if (behaviour.kind === "throws") {
        log.threw = true;
        throw new PickerError(behaviour.error);
      }
      if (behaviour.kind === "garbage") {
        log.returned = behaviour.value;
      } else if (behaviour.kind === "allowed") {
        log.returned = log.allowedIds[behaviour.index % log.allowedIds.length];
      } else {
        const outside = everyId.filter((id) => !log.allowedIds.includes(id));
        log.returned = outside[behaviour.index % outside.length];
      }
      return { lineId: log.returned as string };
    },
  };
}

describe("G1: no session can display text outside the script", () => {
  it("only ever shows fixture line, objection or fallback text, and always ends", async () => {
    // 40 turns at 20 s or more overrun the 10 minute limit, so every run must end.
    const calls = fc.array(step, { minLength: 40, maxLength: 60 });

    await fc.assert(
      fc.asyncProperty(calls, async (steps) => {
        let state = fixtureState();
        let elapsed = 0;

        for (const { pick, input, seconds } of steps) {
          elapsed += seconds;
          const now = new Date(FIXTURE_START + elapsed * 1000);
          const before = state;
          const log: PickerLog = { called: false, threw: false, allowedIds: [], allowedTexts: [] };

          const result = await turnStep(
            fixtureScript,
            MAX_CALL_MINUTES,
            before,
            toTurnInput(input),
            elapsed * 1000,
            simulatedPicker(pick, log),
            now,
          );

          if (limitPassed(before, MAX_CALL_MINUTES, now)) {
            expect(log.called).toBe(false);
            expect(result.displayText).toBe("");
            expect(result.state.turns).toHaveLength(before.turns.length);
            expect(result.state.endReason).toBe("limit_reached");
            expect(result.ended).toBe(true);
          } else {
            expect(result.state.turns).toHaveLength(before.turns.length + 1);
            const turn = result.state.turns[before.turns.length];
            expect(shownTexts.has(result.displayText)).toBe(true);
            expect(callerReplies.has(result.displayText)).toBe(false);
            expect(turn?.prospect.text).toBe(result.displayText);
            for (const text of log.allowedTexts) {
              expect(shownTexts.has(text)).toBe(true);
            }

            const usable =
              log.returned !== undefined && !log.threw && log.allowedIds.includes(log.returned);
            if (usable) {
              expect(turn?.prospect.lineId).toBe(log.returned);
              expect(turn?.fallbackCause).toBeUndefined();
            } else {
              expect(turn?.prospect.lineId).toBeNull();
              expect(turn?.prospect.text).toBe(fixtureScript.fallbackLine.text);
              expect(turn?.fallbackCause).toBeDefined();
            }
          }

          expect(fixtureScript.stages).toContain(result.state.stage);
          expect(new Set(result.state.usedObjections).size).toBe(
            result.state.usedObjections.length,
          );
          state = result.state;
          if (result.ended) {
            break;
          }
        }

        expect(["booked", "prospect_ended", "limit_reached"]).toContain(state.endReason);
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});
