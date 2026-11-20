import type { ScriptConfig, SessionState } from "../types/index.ts";

/**
 * Test-only script: every text is distinct and labelled FIXTURE so a test can tell which
 * line reached the screen. It is not prospect wording, and persona tokens are already filled.
 */
export const fixtureScript: ScriptConfig = {
  persona: { firstName: "FixtureFirst", companyName: "FixtureCo", fleetSize: 12 },
  stages: ["d1_attention", "d2_lawsuit", "fleet_check", "d3_pitch", "d4_schedule"],
  lines: [
    {
      id: "d1.who",
      stage: "d1_attention",
      text: "FIXTURE d1.who",
      nextStage: "d1_attention",
      approved: true,
    },
    {
      id: "d1.okay",
      stage: "d1_attention",
      text: "FIXTURE d1.okay",
      nextStage: "d2_lawsuit",
      approved: true,
    },
    {
      id: "d2.listen",
      stage: "d2_lawsuit",
      text: "FIXTURE d2.listen",
      nextStage: "d2_lawsuit",
      approved: true,
    },
    {
      id: "d2.next",
      stage: "d2_lawsuit",
      text: "FIXTURE d2.next",
      nextStage: "fleet_check",
      approved: true,
    },
    {
      id: "fc.count",
      stage: "fleet_check",
      text: "FIXTURE fc.count: FixtureCo runs 12 trucks",
      nextStage: "d3_pitch",
      approved: true,
    },
    {
      id: "d3.consider",
      stage: "d3_pitch",
      text: "FIXTURE d3.consider",
      nextStage: "d3_pitch",
      approved: true,
    },
    {
      id: "d3.agree",
      stage: "d3_pitch",
      text: "FIXTURE d3.agree",
      nextStage: "d4_schedule",
      approved: true,
    },
    {
      id: "d3.hangup",
      stage: "d3_pitch",
      text: "FIXTURE d3.hangup",
      nextStage: "d3_pitch",
      approved: true,
      endsCall: "prospect_ended",
    },
    {
      id: "d4.time",
      stage: "d4_schedule",
      text: "FIXTURE d4.time",
      nextStage: "d4_schedule",
      approved: true,
    },
    {
      id: "d4.seeinvite",
      stage: "d4_schedule",
      text: "FIXTURE d4.seeinvite",
      nextStage: "d4_schedule",
      approved: true,
      endsCall: "booked",
    },
  ],
  objections: [
    {
      id: "obj.busy",
      prospectLine: "FIXTURE obj.busy",
      callerReply: "FIXTURE obj.busy reply",
      allowedStages: ["d2_lawsuit", "d3_pitch", "d4_schedule"],
      approved: true,
    },
    {
      id: "obj.pitchonly",
      prospectLine: "FIXTURE obj.pitchonly",
      callerReply: "FIXTURE obj.pitchonly reply",
      allowedStages: ["d3_pitch"],
      approved: true,
    },
  ],
  fallbackLine: { text: "FIXTURE fallback", approved: true },
};

export const FIXTURE_START = Date.parse("2026-01-01T10:00:00.000Z");

export function fixtureState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "fixture-session",
    name: "Fixture Candidate",
    stage: "d1_attention",
    usedObjections: [],
    turns: [],
    startedAt: new Date(FIXTURE_START).toISOString(),
    ...overrides,
  };
}
