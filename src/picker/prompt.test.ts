import { describe, expect, it } from "vitest";
import type { CallTurn, PickInput, ScriptConfig } from "../types/index.ts";
import { systemPrompt, userMessage } from "./prompt.ts";

const script: ScriptConfig = {
  persona: { firstName: "Dana", companyName: "Acme Haulage", fleetSize: 42 },
  stages: ["d1_attention", "d2_lawsuit", "fleet_check", "d3_pitch", "d4_schedule"],
  lines: [],
  objections: [],
  fallbackLine: { text: "Sorry, could you say that again?", approved: true },
};

function turn(index: number, candidateText: string, text: string): CallTurn {
  return { index, clientMs: index * 1000, candidateText, prospect: { lineId: `l${index}`, text } };
}

describe("systemPrompt", () => {
  it("states the persona values and the rules", () => {
    const prompt = systemPrompt(script);
    expect(prompt).toContain("Dana");
    expect(prompt).toContain("Acme Haulage");
    expect(prompt).toContain("42");
    expect(prompt).toMatch(/fleet owner/i);
    expect(prompt).toMatch(/cold call/i);
    expect(prompt).toMatch(/stay in character/i);
    expect(prompt).toMatch(/never coach/i);
    expect(prompt).toMatch(/never promise/i);
    expect(prompt).toMatch(/only from the given options/i);
    expect(prompt).toMatch(/untrusted/i);
  });

  it("omits persona facts that are null instead of printing 'null'", () => {
    const prompt = systemPrompt({
      ...script,
      persona: { firstName: null, companyName: null, fleetSize: null },
    });
    expect(prompt).not.toContain("null");
    expect(prompt).not.toContain("undefined");
  });

  it("does not depend on any call input", () => {
    expect(systemPrompt(script)).toBe(systemPrompt(script));
  });
});

describe("userMessage", () => {
  const input: PickInput = {
    stage: "d2_lawsuit",
    recentTurns: [turn(0, "Hi, this is Sam", "Who is this..."), turn(1, "", "Sorry, again?")],
    candidateText: "I'm calling about fleet safety",
    allowed: [
      { id: "d2.listen", text: "Go on." },
      { id: "obj.busy", text: "I'm busy." },
    ],
  };

  it("names the stage", () => {
    expect(userMessage(input)).toContain("d2_lawsuit");
  });

  it("renders earlier turns as Caller and You lines, oldest first", () => {
    const lines = userMessage(input).split("\n");
    const caller = lines.indexOf("Caller: Hi, this is Sam");
    const you = lines.indexOf("You: Who is this...");
    const second = lines.indexOf("You: Sorry, again?");
    expect(caller).toBeGreaterThan(-1);
    expect(you).toBe(caller + 1);
    expect(second).toBeGreaterThan(you);
  });

  it("does not print a Caller line for a turn that was not understood", () => {
    const callerLines = userMessage(input)
      .split("\n")
      .filter((l) => l.startsWith("Caller:"));
    expect(callerLines).toEqual([
      "Caller: Hi, this is Sam",
      "Caller: I'm calling about fleet safety",
    ]);
  });

  it("puts candidateText on the last Caller line, after the earlier turns", () => {
    const lines = userMessage(input).split("\n");
    const callerLines = lines.filter((l) => l.startsWith("Caller:"));
    expect(callerLines.at(-1)).toBe("Caller: I'm calling about fleet safety");
    expect(lines.lastIndexOf("You: Sorry, again?")).toBeLessThan(
      lines.lastIndexOf("Caller: I'm calling about fleet safety"),
    );
  });

  it("lists every allowed option, numbered from 1, with its id and text", () => {
    const message = userMessage(input);
    expect(message).toContain("1. [d2.listen] Go on.");
    expect(message).toContain("2. [obj.busy] I'm busy.");
    expect(message.indexOf("1. [d2.listen]")).toBeGreaterThan(
      message.lastIndexOf("Caller: I'm calling about fleet safety"),
    );
  });

  it("works with no earlier turns", () => {
    const message = userMessage({ ...input, recentTurns: [] });
    expect(message).toContain("Caller: I'm calling about fleet safety");
    expect(message).not.toContain("You:");
  });
});
