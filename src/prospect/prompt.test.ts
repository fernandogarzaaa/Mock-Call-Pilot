import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScriptConfig } from "../types/index.ts";
import { generatorSystemPrompt, generatorUserMessage } from "./prompt.ts";

const seed = JSON.parse(
  readFileSync(new URL("../../config/script.json", import.meta.url), "utf8"),
) as ScriptConfig;

describe("generatorSystemPrompt", () => {
  it("names the prospect, the company, the fleet, and the meeting times", () => {
    const prompt = generatorSystemPrompt(seed);
    expect(prompt).toContain("John");
    expect(prompt).toContain("Lone Mesa Site Services");
    expect(prompt).toContain("24 trucks");
    expect(prompt).toContain("Thursday December 3, 2026 at 10:00 AM Central");
    expect(prompt).toContain("Friday December 4, 2026 at 2:00 PM Central");
    expect(prompt).toContain("john@lonemesasite.com");
    expect(prompt).toContain("only if they ask");
    expect(prompt).not.toContain("[firstName not set]");
  });

  it("forbids coaching, deadbolt, and script, and names the AI answer", () => {
    const prompt = generatorSystemPrompt(seed);
    expect(prompt).toContain("Never coach");
    expect(prompt).toContain("deadbolt");
    expect(prompt).toContain("This is a practice simulation. Let's keep going.");
  });
});

describe("generatorUserMessage", () => {
  it("shows the stage, the allowed next stages, the history, and the caller's words", () => {
    const message = generatorUserMessage({
      stage: "d2_lawsuit",
      recentTurns: [
        {
          index: 0,
          clientMs: 1000,
          candidateText: "Hi, I'm Fernando Garza.",
          prospect: { lineId: "d1.speaking", text: "Yeah, speaking. Who's calling?" },
        },
      ],
      candidateText: "A Texas company got sued after a driver accident.",
      allowedNextStages: ["d2_lawsuit", "d3_pitch"],
    });
    expect(message).toContain("Stage: d2_lawsuit");
    expect(message).toContain("You may move to: d2_lawsuit, d3_pitch");
    expect(message).toContain("Caller: Hi, I'm Fernando Garza.");
    expect(message).toContain("You: Yeah, speaking. Who's calling?");
    expect(message).toContain("Caller: A Texas company got sued after a driver accident.");
  });
});
