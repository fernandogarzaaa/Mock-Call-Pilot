import { describe, expect, it } from "vitest";
import type { LinePicker, PickInput, SessionState, TurnBase } from "../types/index.ts";
import { PickerError } from "../types/index.ts";
import { FIXTURE_START, fixtureScript, fixtureState } from "./fixture.ts";
import { allowedLineIds, applyFallback, applyLine, limitPassed, turnStep } from "./machine.ts";

const PICKER_KINDS = ["picker_error", "picker_timeout", "picker_refusal"] as const;
const ALL_CAUSES = [
  "stt_error",
  "stt_timeout",
  "empty",
  ...PICKER_KINDS,
  "picker_invalid_id",
] as const;

const base = (index: number, candidateText = "hello"): TurnBase => ({
  index,
  clientMs: 1000 * (index + 1),
  candidateText,
});

const at = (seconds: number) => new Date(FIXTURE_START + seconds * 1000);

function pickerReturning(...ids: string[]): LinePicker & { calls: PickInput[] } {
  const calls: PickInput[] = [];
  return {
    calls,
    async pick(input) {
      calls.push(input);
      return { lineId: ids[Math.min(calls.length, ids.length) - 1] as string };
    },
  };
}

function pickerThrowing(error: unknown): LinePicker & { calls: PickInput[] } {
  const calls: PickInput[] = [];
  return {
    calls,
    async pick(input) {
      calls.push(input);
      throw error;
    },
  };
}

async function say(
  state: SessionState,
  text: string,
  picker: LinePicker,
  seconds = 30,
  maxCallMinutes = 15,
) {
  return turnStep(
    fixtureScript,
    maxCallMinutes,
    state,
    { text },
    seconds * 1000,
    picker,
    at(seconds),
  );
}

describe("allowedLineIds", () => {
  it("lists the stage's lines in file order, then objections allowed in that stage", () => {
    expect(allowedLineIds(fixtureScript, fixtureState({ stage: "d3_pitch" }))).toEqual([
      "d3.consider",
      "d3.agree",
      "d3.hangup",
      "obj.busy",
      "obj.pitchonly",
    ]);
  });

  it("offers no objection in a stage its allowedStages leave out", () => {
    expect(allowedLineIds(fixtureScript, fixtureState({ stage: "d1_attention" }))).toEqual([
      "d1.who",
      "d1.okay",
    ]);
    expect(allowedLineIds(fixtureScript, fixtureState({ stage: "d2_lawsuit" }))).toEqual([
      "d2.listen",
      "d2.next",
      "obj.busy",
    ]);
  });

  it("drops an objection once it is used", () => {
    const state = fixtureState({ stage: "d3_pitch", usedObjections: ["obj.busy"] });
    expect(allowedLineIds(fixtureScript, state)).toEqual([
      "d3.consider",
      "d3.agree",
      "d3.hangup",
      "obj.pitchonly",
    ]);
  });
});

describe("applyLine", () => {
  it("appends the turn and moves to the line's nextStage", () => {
    const state = applyLine(fixtureScript, fixtureState(), "d1.okay", base(0, "hi there"));
    expect(state.stage).toBe("d2_lawsuit");
    expect(state.endReason).toBeUndefined();
    expect(state.turns).toEqual([
      {
        index: 0,
        clientMs: 1000,
        candidateText: "hi there",
        prospect: { lineId: "d1.okay", text: "FIXTURE d1.okay" },
      },
    ]);
  });

  it("keeps the stage on a line whose nextStage is the same", () => {
    const state = applyLine(fixtureScript, fixtureState(), "d1.who", base(0));
    expect(state.stage).toBe("d1_attention");
  });

  it("ends the call with the line's endsCall reason and leaves the stage alone", () => {
    const d4 = fixtureState({ stage: "d4_schedule" });
    const booked = applyLine(fixtureScript, d4, "d4.seeinvite", base(0));
    expect(booked.endReason).toBe("booked");
    expect(booked.stage).toBe("d4_schedule");

    const d3 = fixtureState({ stage: "d3_pitch" });
    const hangup = applyLine(fixtureScript, d3, "d3.hangup", base(0));
    expect(hangup.endReason).toBe("prospect_ended");
    expect(hangup.stage).toBe("d3_pitch");
  });

  it("records an objection with its callerReply, keeps the stage and marks it used", () => {
    const state = applyLine(
      fixtureScript,
      fixtureState({ stage: "d3_pitch" }),
      "obj.busy",
      base(0),
    );
    expect(state.stage).toBe("d3_pitch");
    expect(state.usedObjections).toEqual(["obj.busy"]);
    expect(state.endReason).toBeUndefined();
    expect(state.turns[0]?.prospect).toEqual({
      lineId: "obj.busy",
      text: "FIXTURE obj.busy",
      callerReply: "FIXTURE obj.busy reply",
    });
  });

  it("gives plain lines no callerReply", () => {
    const state = applyLine(fixtureScript, fixtureState(), "d1.who", base(0));
    expect(state.turns[0]?.prospect).not.toHaveProperty("callerReply");
  });

  it("throws on an unknown id, another stage's line, a misplaced or used objection", () => {
    const d3 = fixtureState({ stage: "d3_pitch" });
    expect(() => applyLine(fixtureScript, d3, "nope", base(0))).toThrow();
    expect(() => applyLine(fixtureScript, d3, "d1.okay", base(0))).toThrow();
    expect(() => applyLine(fixtureScript, fixtureState(), "obj.busy", base(0))).toThrow();
    expect(() =>
      applyLine(fixtureScript, fixtureState({ stage: "d2_lawsuit" }), "obj.pitchonly", base(0)),
    ).toThrow();
    expect(() =>
      applyLine(fixtureScript, { ...d3, usedObjections: ["obj.busy"] }, "obj.busy", base(0)),
    ).toThrow();
  });

  it("does not mutate the state it was given", () => {
    const state = fixtureState({ stage: "d3_pitch" });
    const snapshot = structuredClone(state);
    applyLine(fixtureScript, state, "obj.busy", base(0));
    applyLine(fixtureScript, state, "d3.agree", base(0));
    expect(state).toEqual(snapshot);
  });
});

describe("applyFallback", () => {
  for (const cause of ALL_CAUSES) {
    it(`records ${cause} with the fallback line and nothing else changed`, () => {
      const before = fixtureState({ stage: "d3_pitch", usedObjections: ["obj.busy"] });
      const after = applyFallback(fixtureScript, before, cause, base(0, "mumble"));
      expect(after).toEqual({
        ...before,
        turns: [
          {
            index: 0,
            clientMs: 1000,
            candidateText: "mumble",
            fallbackCause: cause,
            prospect: { lineId: null, text: "FIXTURE fallback" },
          },
        ],
      });
      expect(before.turns).toEqual([]);
    });
  }
});

describe("limitPassed", () => {
  const state = fixtureState();
  it("is false up to and including the limit and true after it", () => {
    expect(limitPassed(state, 10, at(0))).toBe(false);
    expect(limitPassed(state, 10, at(599))).toBe(false);
    expect(limitPassed(state, 10, at(600))).toBe(false);
    expect(limitPassed(state, 10, at(601))).toBe(true);
  });

  it("scales with maxCallMinutes", () => {
    expect(limitPassed(state, 1, at(61))).toBe(true);
    expect(limitPassed(state, 2, at(61))).toBe(false);
  });
});

describe("turnStep", () => {
  it("walks a call from Deadbolt 1 to booked", async () => {
    const picker = pickerReturning("d1.okay", "d2.next", "fc.count", "d3.agree", "d4.seeinvite");
    let state = fixtureState();
    const shown: string[] = [];
    const stages: string[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await say(state, `turn ${i}`, picker, 30 * (i + 1));
      state = result.state;
      shown.push(result.displayText);
      stages.push(state.stage);
      expect(result.ended).toBe(i === 4);
    }
    expect(shown).toEqual([
      "FIXTURE d1.okay",
      "FIXTURE d2.next",
      "FIXTURE fc.count: FixtureCo runs 12 trucks",
      "FIXTURE d3.agree",
      "FIXTURE d4.seeinvite",
    ]);
    expect(stages).toEqual(["d2_lawsuit", "fleet_check", "d3_pitch", "d4_schedule", "d4_schedule"]);
    expect(state.endReason).toBe("booked");
    expect(state.turns.map((t) => t.index)).toEqual([0, 1, 2, 3, 4]);
    expect(state.turns.map((t) => t.candidateText)).toEqual([
      "turn 0",
      "turn 1",
      "turn 2",
      "turn 3",
      "turn 4",
    ]);
    expect(state.turns.map((t) => t.clientMs)).toEqual([30000, 60000, 90000, 120000, 150000]);
    expect(state.turns.every((t) => t.fallbackCause === undefined)).toBe(true);
  });

  it("ends with prospect_ended when the picked line hangs up", async () => {
    const start = fixtureState({ stage: "d3_pitch" });
    const result = await say(start, "bye", pickerReturning("d3.hangup"));
    expect(result.ended).toBe(true);
    expect(result.state.endReason).toBe("prospect_ended");
    expect(result.displayText).toBe("FIXTURE d3.hangup");
  });

  it("keeps the stage on an objection and never offers it again", async () => {
    const picker = pickerReturning("obj.busy", "d3.consider");
    const first = await say(fixtureState({ stage: "d3_pitch" }), "pitch", picker);
    expect(first.displayText).toBe("FIXTURE obj.busy");
    expect(first.ended).toBe(false);
    expect(first.state.stage).toBe("d3_pitch");
    expect(first.state.turns[0]?.prospect.callerReply).toBe("FIXTURE obj.busy reply");
    expect(first.state.usedObjections).toEqual(["obj.busy"]);

    await say(first.state, "answer", picker, 60);
    expect(picker.calls[1]?.allowed.map((a) => a.id)).toEqual([
      "d3.consider",
      "d3.agree",
      "d3.hangup",
      "obj.pitchonly",
    ]);

    const again = await say(first.state, "answer", pickerReturning("obj.busy"), 60);
    expect(again.state.turns.at(-1)?.fallbackCause).toBe("picker_invalid_id");
    expect(again.displayText).toBe("FIXTURE fallback");
    expect(again.state.usedObjections).toEqual(["obj.busy"]);
  });

  it("hands the picker the stage, the candidate's words, and id/text pairs", async () => {
    const picker = pickerReturning("d3.consider");
    await say(fixtureState({ stage: "d3_pitch" }), "what I said", picker);
    expect(picker.calls).toEqual([
      {
        stage: "d3_pitch",
        recentTurns: [],
        candidateText: "what I said",
        allowed: [
          { id: "d3.consider", text: "FIXTURE d3.consider" },
          { id: "d3.agree", text: "FIXTURE d3.agree" },
          { id: "d3.hangup", text: "FIXTURE d3.hangup" },
          { id: "obj.busy", text: "FIXTURE obj.busy" },
          { id: "obj.pitchonly", text: "FIXTURE obj.pitchonly" },
        ],
      },
    ]);
  });

  it("passes only the last 6 completed turns, oldest first", async () => {
    let state = fixtureState();
    const filler = pickerReturning("d1.who");
    for (let i = 0; i < 8; i++) {
      state = (await say(state, `t${i}`, filler, 10 * (i + 1))).state;
    }
    const picker = pickerReturning("d1.who");
    await say(state, "latest", picker, 100);
    const recent = picker.calls[0]?.recentTurns ?? [];
    expect(recent.map((t) => t.candidateText)).toEqual(["t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(picker.calls[0]?.candidateText).toBe("latest");
  });

  it("calls pick as a method so the picker's own state stays reachable", async () => {
    class Counting implements LinePicker {
      seen = 0;
      async pick(): Promise<{ lineId: string }> {
        this.seen += 1;
        return { lineId: "d1.who" };
      }
    }
    const picker = new Counting();
    await say(fixtureState(), "hi", picker);
    expect(picker.seen).toBe(1);
  });

  it("falls back with stt_error / stt_timeout without calling the picker", async () => {
    for (const cause of ["stt_error", "stt_timeout"] as const) {
      const picker = pickerReturning("d1.okay");
      const result = await turnStep(
        fixtureScript,
        15,
        fixtureState({ stage: "d2_lawsuit" }),
        { sttError: cause },
        4200,
        picker,
        at(30),
      );
      expect(picker.calls).toEqual([]);
      expect(result.displayText).toBe("FIXTURE fallback");
      expect(result.ended).toBe(false);
      expect(result.state.stage).toBe("d2_lawsuit");
      expect(result.state.turns).toEqual([
        {
          index: 0,
          clientMs: 4200,
          candidateText: "",
          fallbackCause: cause,
          prospect: { lineId: null, text: "FIXTURE fallback" },
        },
      ]);
    }
  });

  it("falls back with empty on blank text without calling the picker", async () => {
    for (const text of ["", "   ", "\n\t"]) {
      const picker = pickerReturning("d1.okay");
      const result = await say(fixtureState(), text, picker);
      expect(picker.calls).toEqual([]);
      expect(result.displayText).toBe("FIXTURE fallback");
      expect(result.state.turns[0]?.fallbackCause).toBe("empty");
      expect(result.state.turns[0]?.candidateText).toBe("");
    }
  });

  for (const kind of PICKER_KINDS) {
    it(`records a thrown PickerError(${kind}) as that cause`, async () => {
      const result = await say(fixtureState(), "hi", pickerThrowing(new PickerError(kind)));
      expect(result.state.turns[0]?.fallbackCause).toBe(kind);
      expect(result.displayText).toBe("FIXTURE fallback");
      expect(result.state.turns[0]?.candidateText).toBe("hi");
      expect(result.ended).toBe(false);
    });
  }

  it("records any other thrown value as picker_error", async () => {
    for (const thrown of [new Error("boom"), "boom", undefined]) {
      const result = await say(fixtureState(), "hi", pickerThrowing(thrown));
      expect(result.state.turns[0]?.fallbackCause).toBe("picker_error");
    }
  });

  it("records an id outside the allowed list as picker_invalid_id", async () => {
    for (const id of ["not-a-line", "d2.next", "obj.pitchonly", "", "constructor"]) {
      const result = await say(fixtureState(), "hi", pickerReturning(id));
      expect(result.state.turns[0]?.fallbackCause).toBe("picker_invalid_id");
      expect(result.displayText).toBe("FIXTURE fallback");
      expect(result.state.stage).toBe("d1_attention");
    }
  });

  it("treats a malformed picker answer as picker_invalid_id", async () => {
    for (const answer of [undefined, null, {}, { lineId: 3 }]) {
      const picker = { pick: async () => answer as unknown as { lineId: string } };
      const result = await say(fixtureState(), "hi", picker);
      expect(result.state.turns[0]?.fallbackCause).toBe("picker_invalid_id");
    }
  });

  it("leaves the stage and used objections alone on a fallback", async () => {
    const start = fixtureState({ stage: "d3_pitch", usedObjections: ["obj.busy"] });
    const result = await say(start, "hi", pickerReturning("zzz"));
    expect(result.state.stage).toBe("d3_pitch");
    expect(result.state.usedObjections).toEqual(["obj.busy"]);
    expect(result.state.endReason).toBeUndefined();
  });

  it("ends with limit_reached and no new turn once the limit has passed", async () => {
    const picker = pickerReturning("d1.okay");
    const start = fixtureState();
    const input = { text: "late" };
    const result = await turnStep(fixtureScript, 10, start, input, 700000, picker, at(601));
    expect(result).toEqual({
      state: { ...start, endReason: "limit_reached" },
      displayText: "",
      ended: true,
    });
    expect(picker.calls).toEqual([]);
    expect(start.endReason).toBeUndefined();
  });

  it("checks the limit before looking at the input", async () => {
    const result = await turnStep(
      fixtureScript,
      10,
      fixtureState(),
      { sttError: "stt_error" },
      1,
      pickerReturning("d1.okay"),
      at(601),
    );
    expect(result.state.turns).toEqual([]);
    expect(result.state.endReason).toBe("limit_reached");
  });

  it("still runs the turn exactly at the limit", async () => {
    const result = await turnStep(
      fixtureScript,
      10,
      fixtureState(),
      { text: "hi" },
      600000,
      pickerReturning("d1.okay"),
      at(600),
    );
    expect(result.state.turns).toHaveLength(1);
    expect(result.ended).toBe(false);
  });

  it("does not mutate the state it was given", async () => {
    const start = fixtureState();
    const snapshot = structuredClone(start);
    await say(start, "hi", pickerReturning("d1.okay"));
    await say(start, "hi", pickerReturning("zzz"));
    expect(start).toEqual(snapshot);
  });
});
