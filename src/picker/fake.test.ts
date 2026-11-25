import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CallTurn, PickInput, ScriptConfig, Stage } from "../types/index.ts";
import { FakePicker } from "./fake.ts";

const seed = JSON.parse(
  readFileSync(new URL("../../config/script.json", import.meta.url), "utf8"),
) as ScriptConfig;

function inputFor(
  script: ScriptConfig,
  stage: Stage,
  used: string[] = [],
  recent: CallTurn[] = [],
  candidateText = "hello",
): PickInput {
  return {
    stage,
    recentTurns: recent,
    candidateText,
    allowed: [
      ...script.lines.filter((l) => l.stage === stage).map((l) => ({ id: l.id, text: l.text })),
      ...script.objections
        .filter((o) => o.allowedStages.includes(stage) && !used.includes(o.id))
        .map((o) => ({ id: o.id, text: o.prospectLine })),
    ],
  };
}

function turn(index: number, lineId: string, text: string): CallTurn {
  return { index, clientMs: 1000, candidateText: "hello", prospect: { lineId, text } };
}

describe("FakePicker", () => {
  it("walks the seed graph from the first stage to a booked call", async () => {
    const picker = new FakePicker(seed);
    let stage: Stage = "d1_attention";
    const visited: string[] = [];
    const recent: CallTurn[] = [];
    let ended: string | undefined;

    for (let i = 0; i < 20 && ended === undefined; i++) {
      const { lineId } = await picker.pick(inputFor(seed, stage, [], recent));
      const line = seed.lines.find((l) => l.id === lineId);
      expect(line).toBeDefined();
      visited.push(lineId);
      recent.push(turn(recent.length, lineId, line?.text ?? ""));
      if (line?.endsCall !== undefined) ended = line.endsCall;
      else stage = line?.nextStage ?? stage;
    }

    expect(ended).toBe("booked");
    expect(visited).toEqual(["d1.hello", "d1.okay", "d2.next", "d3.agree", "d4.seeinvite"]);
  });

  it("answers the candidate's opening instead of a fixed first line", async () => {
    const picker = new FakePicker(seed);
    const cases: [string, string][] = [
      ["Hi, is this John?", "d1.speaking"],
      ["John?", "d1.whos"],
      ["Hi John", "d1.whos"],
      ["Can I have 30 seconds?", "d1.goahead"],
      ["Hi John, I'm Sarah from Can-Am Wireless", "obj.busy"],
      ["hello", "d1.hello"],
    ];
    for (const [text, expected] of cases) {
      const { lineId } = await picker.pick(inputFor(seed, "d1_attention", [], [], text));
      expect(lineId, text).toBe(expected);
    }
  });

  it("answers a fleet question in the same turn, not one turn late", async () => {
    const picker = new FakePicker(seed);
    const { lineId } = await picker.pick(
      inputFor(
        seed,
        "d2_lawsuit",
        [],
        [turn(0, "d1.okay", "Okay.")],
        "How many trucks do you run?",
      ),
    );
    expect(lineId).toBe("fc.count");
  });

  it("answers a GPS argument with the sales-pitch line, not the advance", async () => {
    const picker = new FakePicker(seed);
    const { lineId } = await picker.pick(
      inputFor(seed, "d2_lawsuit", [], [turn(0, "d1.okay", "Okay.")], "We've already got GPS"),
    );
    expect(lineId).toBe("d2.listen");
  });

  it("escalates a meeting ask: send info, then think about it, then agree", async () => {
    const picker = new FakePicker(seed);
    const ask = "Can we set up twenty minutes this week?";
    const first = await picker.pick(
      inputFor(seed, "d3_pitch", [], [turn(0, "fc.count", "x")], ask),
    );
    expect(first.lineId).toBe("obj.sendinfo");
    const second = await picker.pick(
      inputFor(seed, "d3_pitch", ["obj.sendinfo"], [turn(0, "fc.count", "x")], ask),
    );
    expect(second.lineId).toBe("obj.thinkaboutit");
    const third = await picker.pick(
      inputFor(
        seed,
        "d3_pitch",
        ["obj.sendinfo", "obj.thinkaboutit"],
        [turn(0, "fc.count", "x")],
        ask,
      ),
    );
    expect(third.lineId).toBe("d3.agree");
  });

  it("ends the call when the candidate agrees to email or declines", async () => {
    const picker = new FakePicker(seed);
    const recent = [turn(0, "fc.count", "x")];
    expect(
      (await picker.pick(inputFor(seed, "d3_pitch", [], recent, "Sure, I'll send it over"))).lineId,
    ).toBe("d3.consider");
    expect(
      (await picker.pick(inputFor(seed, "d3_pitch", [], recent, "No thanks, not interested")))
        .lineId,
    ).toBe("d3.hangup");
  });

  it("answers scheduling questions instead of booking at once", async () => {
    const picker = new FakePicker(seed);
    const recent = [turn(0, "d3.agree", "x")];
    expect(
      (await picker.pick(inputFor(seed, "d4_schedule", [], recent, "What is your email?"))).lineId,
    ).toBe("d4.email");
    expect(
      (await picker.pick(inputFor(seed, "d4_schedule", [], recent, "Thursday works for me")))
        .lineId,
    ).toBe("d4.thursday");
  });

  it("returns the first stage-advancing line when no rule matches", async () => {
    const picker = new FakePicker(seed);
    const recent = [turn(0, "d1.hello", "Hello?")];
    const result = await picker.pick(inputFor(seed, "d1_attention", [], recent));
    expect(result).toEqual({ lineId: "d1.okay" });
  });

  it("advances with a neutral line in each stage instead of stalling", async () => {
    const picker = new FakePicker(seed);
    const stages: Stage[] = ["d1_attention", "d2_lawsuit", "d3_pitch"];
    for (const stage of stages) {
      const { lineId } = await picker.pick(inputFor(seed, stage, [], [turn(0, "x", "x")]));
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
