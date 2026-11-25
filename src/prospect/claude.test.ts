import { describe, expect, it } from "vitest";
import type { PickInput } from "../types/index.ts";
import { ClaudeGenerator, type GeneratorClient } from "./claude.ts";

type Create = GeneratorClient["beta"]["messages"]["create"];
type Response = Awaited<ReturnType<Create>>;
type Params = Record<string, unknown>;

const SYSTEM = "SYSTEM PROMPT TEXT";
const input: PickInput = {
  stage: "d2_lawsuit",
  recentTurns: [],
  candidateText: "A Texas company got sued after a driver accident.",
  allowed: [{ id: "d2.listen", text: "Go on." }],
  allowedNextStages: ["d2_lawsuit", "d3_pitch"],
};

function stub(respond: (params: Record<string, unknown>) => Promise<Response>) {
  const calls: { params: Record<string, unknown>; options: unknown }[] = [];
  const client: GeneratorClient = {
    beta: {
      messages: {
        create: (params, options) => {
          const recorded = params as unknown as Params;
          calls.push({ params: recorded, options });
          return respond(recorded);
        },
      },
    },
  };
  return { client, calls };
}

function ok(text: string): Response {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

describe("ClaudeGenerator", () => {
  it("returns the generated text with its next stage", async () => {
    const { client, calls } = stub(async () =>
      ok(JSON.stringify({ text: "That gets my attention. Go on.", nextStage: "d2_lawsuit" })),
    );
    const g = new ClaudeGenerator(client, "claude-opus-5-5", "low", SYSTEM);
    const result = await g.pick(input);
    expect(result).toEqual({
      text: "That gets my attention. Go on.",
      nextStage: "d2_lawsuit",
      endReason: undefined,
    });
    expect(calls).toHaveLength(1);
    const params = calls[0]?.params;
    expect(params?.model).toBe("claude-opus-5-5");
    const system = params?.system as { text: string }[];
    expect(system[0]?.text).toBe(SYSTEM);
  });

  it("returns booked when the generator agrees to the meeting", async () => {
    const { client } = stub(async () =>
      ok(
        JSON.stringify({
          text: "Alright. Twenty minutes, Thursday at ten. I can do that.",
          nextStage: "d4_schedule",
          endReason: "booked",
        }),
      ),
    );
    const g = new ClaudeGenerator(client, "claude-opus-5-5", "low", SYSTEM);
    const result = await g.pick({
      ...input,
      stage: "d3_pitch",
      allowedNextStages: ["d3_pitch", "d4_schedule"],
    });
    expect(result).toEqual({
      text: "Alright. Twenty minutes, Thursday at ten. I can do that.",
      nextStage: "d4_schedule",
      endReason: "booked",
    });
  });

  it("throws picker_error when the model refuses or answers garbage", async () => {
    const refused = stub(async () => ({ stop_reason: "refusal", content: [] }));
    const g1 = new ClaudeGenerator(refused.client, "claude-opus-5-5", "low", SYSTEM);
    await expect(g1.pick(input)).rejects.toMatchObject({ kind: "picker_refusal" });

    const garbage = stub(async () => ok("not json"));
    const g2 = new ClaudeGenerator(garbage.client, "claude-opus-5-5", "low", SYSTEM);
    await expect(g2.pick(input)).rejects.toMatchObject({ kind: "picker_error" });

    const empty = stub(async () => ok(JSON.stringify({ text: "   ", nextStage: "d2_lawsuit" })));
    const g3 = new ClaudeGenerator(empty.client, "claude-opus-5-5", "low", SYSTEM);
    await expect(g3.pick(input)).rejects.toMatchObject({ kind: "picker_error" });
  });

  it("throws picker_timeout on a timeout, picker_error otherwise", async () => {
    const timeout = stub(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    });
    const g1 = new ClaudeGenerator(timeout.client, "claude-opus-5-5", "low", SYSTEM);
    await expect(g1.pick(input)).rejects.toMatchObject({ kind: "picker_timeout" });

    const other = stub(async () => {
      throw new Error("boom");
    });
    const g2 = new ClaudeGenerator(other.client, "claude-opus-5-5", "low", SYSTEM);
    await expect(g2.pick(input)).rejects.toMatchObject({ kind: "picker_error" });
  });
});
