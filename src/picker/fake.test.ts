import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CallTurn, PickInput, ScriptConfig, Stage } from "../types/index.ts";
import { FakePicker } from "./fake.ts";

const seed = JSON.parse(
  readFileSync(new URL("../../config/script.json", import.meta.url), "utf8"),
) as ScriptConfig;

function inputFor(script: ScriptConfig, stage: Stage, used: string[] = []): PickInput {
  return {
    stage,
    recentTurns: [],
    candidateText: "hello",
    allowed: [
      ...script.lines.filter((l) => l.stage === stage).map((l) => ({ id: l.id, text: l.text })),
      ...script.objections
        .filter((o) => o.allowedStages.includes(stage) && !used.includes(o.id))
        .map((o) => ({ id: o.id, text: o.prospectLine })),
    ],
  };
}

describe("FakePicker", () => {
  it("walks the seed graph from the first stage to a booked call", async () => {
    const picker = new FakePicker(seed);
    let stage: Stage = "d1_attention";
    const visited: string[] = [];
    let ended: string | undefined;

    for (let i = 0; i < 20 && ended === undefined; i++) {
      const { lineId } = await picker.pick(inputFor(seed, stage));
      const line = seed.lines.find((l) => l.id === lineId);
      expect(line).toBeDefined();
      visited.push(lineId);
      if (line?.endsCall !== undefined) ended = line.endsCall;
      else stage = line?.nextStage ?? stage;
    }

    expect(ended).toBe("booked");
    expect(visited).toEqual(["d1.okay", "d2.next", "fc.count", "d3.agree", "d4.seeinvite"]);
  });

  it("returns the first stage-advancing line, skipping lines that keep the stage", async () => {
    const picker = new FakePicker(seed);
    const result = await picker.pick(inputFor(seed, "d1_attention"));
    expect(result).toEqual({ lineId: "d1.okay" });
  });

  it("never returns an objection, a prospect_ended line, or a stage-keeping line", async () => {
    const picker = new FakePicker(seed);
    const stages: Stage[] = ["d1_attention", "d2_lawsuit", "fleet_check", "d3_pitch"];
    for (const stage of stages) {
      const { lineId } = await picker.pick(inputFor(seed, stage));
      const line = seed.lines.find((l) => l.id === lineId);
      expect(line, `${stage} returned a non-line id ${lineId}`).toBeDefined();
      expect(line?.endsCall).toBeUndefined();
      expect(line?.nextStage).not.toBe(stage);
    }
  });

  it("in d4_schedule returns the booked line even when an unused objection is offered", async () => {
    const picker = new FakePicker(seed);
    const input = inputFor(seed, "d4_schedule");
    expect(input.allowed.some((a) => a.id.startsWith("obj."))).toBe(true);
    expect(await picker.pick(input)).toEqual({ lineId: "d4.seeinvite" });
  });

  it("looks up lines in the script it was constructed with", async () => {
    const base = { stage: "d2_lawsuit", approved: true } as const;
    const script: ScriptConfig = {
      ...seed,
      lines: [
        { ...base, id: "x.stay", text: "stay", nextStage: "d2_lawsuit" },
        { ...base, id: "x.go", text: "go", nextStage: "d3_pitch" },
      ],
    };
    const result = await new FakePicker(script).pick(inputFor(script, "d2_lawsuit"));
    expect(result).toEqual({ lineId: "x.go" });
  });

  it("ignores allowed ids that are not script lines", async () => {
    const input: PickInput = {
      stage: "d2_lawsuit",
      recentTurns: [] as CallTurn[],
      candidateText: "hi",
      allowed: [{ id: "obj.busy", text: "busy" }, ...inputFor(seed, "d2_lawsuit").allowed],
    };
    expect(await new FakePicker(seed).pick(input)).toEqual({ lineId: "d2.next" });
  });

  it("throws picker_error when nothing allowed can advance the call", async () => {
    const input: PickInput = {
      stage: "d3_pitch",
      recentTurns: [],
      candidateText: "hi",
      allowed: [
        { id: "d3.consider", text: "x" },
        { id: "d3.hangup", text: "x" },
      ],
    };
    await expect(new FakePicker(seed).pick(input)).rejects.toMatchObject({ kind: "picker_error" });
  });

  it("throws picker_error in d4_schedule when no booked line is allowed", async () => {
    const input: PickInput = {
      stage: "d4_schedule",
      recentTurns: [],
      candidateText: "hi",
      allowed: [{ id: "d4.time", text: "x" }],
    };
    await expect(new FakePicker(seed).pick(input)).rejects.toMatchObject({ kind: "picker_error" });
  });
});
