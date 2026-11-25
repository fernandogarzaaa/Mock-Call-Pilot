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
    allowedNextStages: [
      stage,
      ...new Set(script.lines.filter((l) => l.stage === stage).map((l) => l.nextStage)),
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
    const used: string[] = [];
    let ended: string | undefined;
    // A realistic call: each candidate line genuinely moves the call forward.
    const script: [string, string][] = [
      ["Hi, is this John?", "d1.speaking"],
      ["Can I have 30 seconds?", "d1.goahead"],
      ["How many trucks do you run?", "fc.count"],
      ["Can we set up twenty minutes this week?", "obj.sendinfo"],
      ["Can we set up twenty minutes this week?", "obj.thinkaboutit"],
      ["Can we set up twenty minutes this week?", "d3.agree"],
      ["Thursday works for me", "d4.thursday"],
    ];

    for (const [text, expected] of script) {
      const { lineId } = await picker.pick(inputFor(seed, stage, used, recent, text));
      expect(lineId, text).toBe(expected);
      const line = seed.lines.find((l) => l.id === lineId);
      const objection = seed.objections.find((o) => o.id === lineId);
      visited.push(lineId);
      recent.push(turn(recent.length, lineId, line?.text ?? objection?.prospectLine ?? ""));
      if (objection !== undefined) used.push(objection.id);
      if (line?.endsCall !== undefined) ended = line.endsCall;
      else if (line !== undefined) stage = line.nextStage;
    }

    expect(ended).toBe("booked");
    expect(visited).toEqual([
      "d1.speaking",
      "d1.goahead",
      "fc.count",
      "obj.sendinfo",
      "obj.thinkaboutit",
      "d3.agree",
      "d4.thursday",
    ]);
  });

  it("stays and prompts on filler instead of racing to booked", async () => {
    const picker = new FakePicker(seed);
    const open = [turn(0, "d1.hello", "Hello?")];
    // "Hello?" back at the prospect asks who they are, it does not advance.
    expect((await picker.pick(inputFor(seed, "d1_attention", [], open, "Hello?"))).lineId).toBe(
      "d1.whos",
    );
    // "Okay." to "who's this?" asks who they are again, it does not advance.
    expect(
      (
        await picker.pick(
          inputFor(seed, "d1_attention", [], [turn(0, "d1.whos", "Yeah... who's this?")], "Okay."),
        )
      ).lineId,
    ).toBe("d1.whos");
    // "Okay." in the lawsuit stage prompts for the story, it does not advance.
    expect(
      (await picker.pick(inputFor(seed, "d2_lawsuit", [], [turn(0, "d1.okay", "Okay.")], "Okay.")))
        .lineId,
    ).toBe("d2.listen");
    // "Okay." in the pitch asks for information, it does not agree to a meeting.
    expect(
      (await picker.pick(inputFor(seed, "d3_pitch", [], [turn(0, "fc.count", "x")], "Okay.")))
        .lineId,
    ).toBe("obj.sendinfo");
    // A vague "sure" in scheduling asks what times they have, it does not book.
    expect(
      (
        await picker.pick(
          inputFor(seed, "d4_schedule", [], [turn(0, "d3.agree", "x")], "Sure, sure, why not?"),
        )
      ).lineId,
    ).toBe("d4.time");
  });

  it("answers the candidate's opening instead of a fixed first line", async () => {
    const picker = new FakePicker(seed);
    const cases: [string, string][] = [
      ["Hi, is this John?", "d1.speaking"],
      ["John?", "d1.whos"],
      ["Hi John", "d1.whos"],
      ["Can I have 30 seconds?", "d1.goahead"],
      ["Hi John, I'm Sarah from Can-Am Wireless", "obj.busy"],
      ["Hi, I'm Fernando Garza.", "d1.speaking"],
      ["I'm Fernando Garza.", "d1.speaking"],
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
    const result = await picker.pick(inputFor(seed, "d1_attention", [], recent, "xyz"));
    expect(result).toEqual({ lineId: "d1.okay" });
  });

  it("advances with a neutral line in each stage instead of stalling", async () => {
    const picker = new FakePicker(seed);
    const stages: Stage[] = ["d1_attention", "d2_lawsuit", "d3_pitch"];
    for (const stage of stages) {
      const { lineId } = await picker.pick(inputFor(seed, stage, [], [turn(0, "x", "x")], "xyz"));
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
      allowedNextStages: ["d2_lawsuit", "d3_pitch"],
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
      allowedNextStages: ["d3_pitch", "d4_schedule"],
    };
    await expect(new FakePicker(seed).pick(input)).rejects.toMatchObject({ kind: "picker_error" });
  });

  it("throws picker_error in d4_schedule when no booked line is allowed", async () => {
    const input: PickInput = {
      stage: "d4_schedule",
      recentTurns: [],
      candidateText: "hi",
      allowed: [{ id: "d4.time", text: "x" }],
      allowedNextStages: ["d4_schedule"],
    };
    await expect(new FakePicker(seed).pick(input)).rejects.toMatchObject({ kind: "picker_error" });
  });
});
