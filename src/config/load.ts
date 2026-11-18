import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PilotConfig, ResolvedConfig, ScriptConfig } from "../types/index.ts";
import { ConfigError } from "../types/index.ts";

const stageSchema = z.enum([
  "d1_attention",
  "d2_lawsuit",
  "fleet_check",
  "d3_pitch",
  "d4_schedule",
]);

const scriptSchema: z.ZodType<ScriptConfig> = z.strictObject({
  persona: z.strictObject({
    firstName: z.string().min(1).nullable(),
    companyName: z.string().min(1).nullable(),
    fleetSize: z.number().int().nullable(),
  }),
  stages: z.array(stageSchema),
  lines: z.array(
    z.strictObject({
      id: z.string().min(1),
      stage: stageSchema,
      text: z.string().min(1),
      nextStage: stageSchema,
      approved: z.boolean(),
      endsCall: z.enum(["booked", "prospect_ended"]).optional(),
    }),
  ),
  objections: z.array(
    z.strictObject({
      id: z.string().min(1),
      prospectLine: z.string().min(1),
      callerReply: z.string().min(1),
      allowedStages: z.array(stageSchema),
      approved: z.boolean(),
    }),
  ),
  fallbackLine: z.strictObject({ text: z.string().min(1), approved: z.boolean() }),
});

const textGap = z.string().min(1).nullable();
const minutesGap = z.number().int().positive().nullable();

const pilotSchema: z.ZodType<PilotConfig> = z.strictObject({
  gaps: z.strictObject({
    interviewFlow: textGap,
    testWindow: textGap,
    retentionDays: minutesGap,
    sourceLiveTest: textGap,
    taskInstructions: textGap,
    callerCompanyName: textGap,
    maxCallMinutes: minutesGap,
  }),
  settings: z.strictObject({
    recordingNotice: z.string().min(1),
    clientDetails: z.string().min(1),
    demoMaxCallMinutes: z.number().int().positive(),
  }),
});

const MIN_FLEET_SIZE = 10;
const TEXT_PLACEHOLDER = "PLACEHOLDER: not client-approved";
const RETENTION_PLACEHOLDER = "[not yet set]";
const TOKEN = /\{([^{}]*)\}/g;

const PERSONA_TOKENS = ["firstName", "companyName", "fleetSize"];

function readJson<T>(
  dir: string,
  file: string,
  schema: z.ZodType<T>,
  problems: string[],
): T | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (error) {
    problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    problems.push(`${file}: ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
  }
  return null;
}

function unknownTokens(text: string, allowed: readonly string[]): string[] {
  return [...text.matchAll(TOKEN)]
    .map((match) => match[1])
    .filter((name) => !allowed.includes(name));
}

/** One pass, so a substituted value that itself contains braces is never expanded again. */
function fill(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] as string) : whole,
  );
}

function checkTokens(
  path: string,
  text: string,
  allowed: readonly string[],
  problems: string[],
): void {
  for (const name of unknownTokens(text, allowed)) {
    problems.push(`${path}: unknown token {${name}}`);
  }
}

export function loadConfig(dir: string, env: Record<string, string | undefined>): ResolvedConfig {
  const problems: string[] = [];
  const script = readJson(dir, "script.json", scriptSchema, problems);
  const pilot = readJson(dir, "pilot.json", pilotSchema, problems);
  if (env.MODE !== "live" && env.MODE !== "demo") {
    problems.push("env.MODE: must be live or demo");
  }
  // Without both files there is nothing further to check.
  if (!script || !pilot) throw new ConfigError(problems);

  const live = env.MODE === "live";
  const { persona, lines, objections, fallbackLine } = script;
  const { gaps, settings } = pilot;

  if (persona.fleetSize !== null && persona.fleetSize < MIN_FLEET_SIZE) {
    problems.push(`persona.fleetSize: ${persona.fleetSize} is under ${MIN_FLEET_SIZE}`);
  }
  for (const line of lines) {
    checkTokens(`lines.${line.id}.text`, line.text, PERSONA_TOKENS, problems);
  }
  for (const objection of objections) {
    const base = `objections.${objection.id}`;
    checkTokens(`${base}.prospectLine`, objection.prospectLine, PERSONA_TOKENS, problems);
    checkTokens(`${base}.callerReply`, objection.callerReply, PERSONA_TOKENS, problems);
  }
  checkTokens("fallbackLine.text", fallbackLine.text, PERSONA_TOKENS, problems);
  checkTokens("settings.recordingNotice", settings.recordingNotice, ["retentionDays"], problems);
  checkTokens("settings.clientDetails", settings.clientDetails, [], problems);
  if (gaps.taskInstructions !== null) {
    checkTokens("gaps.taskInstructions", gaps.taskInstructions, ["callerCompanyName"], problems);
  }

  if (live) {
    for (const [key, value] of Object.entries(gaps)) {
      if (value === null) problems.push(`gaps.${key}: not set`);
    }
    for (const [key, value] of Object.entries(persona)) {
      if (value === null) problems.push(`persona.${key}: not set`);
    }
    for (const line of lines) {
      if (!line.approved) problems.push(`lines.${line.id}.approved: not client-approved`);
    }
    for (const objection of objections) {
      if (!objection.approved) {
        problems.push(`objections.${objection.id}.approved: not client-approved`);
      }
    }
    if (!fallbackLine.approved) problems.push("fallbackLine.approved: not client-approved");
    if (!env.ACCESS_CODE) problems.push("env.ACCESS_CODE: not set");
    if (env.STT === "fake") {
      problems.push("env.STT: fake speech-to-text is not allowed in live mode");
    } else if (!env.ELEVENLABS_API_KEY) {
      problems.push("env.ELEVENLABS_API_KEY: not set");
    }
    if (env.PICKER === "fake") {
      problems.push("env.PICKER: fake line picker is not allowed in live mode");
    } else if (!env.ANTHROPIC_API_KEY) {
      problems.push("env.ANTHROPIC_API_KEY: not set");
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);

  const personaValues: Record<string, string> = {
    firstName: persona.firstName ?? "[firstName not set]",
    companyName: persona.companyName ?? "[companyName not set]",
    fleetSize: persona.fleetSize === null ? "[fleetSize not set]" : String(persona.fleetSize),
  };
  const fillPersona = (text: string): string => fill(text, personaValues);

  const retention =
    gaps.retentionDays === null ? RETENTION_PLACEHOLDER : String(gaps.retentionDays);
  const callerCompanyName = gaps.callerCompanyName ?? TEXT_PLACEHOLDER;
  const taskInstructions =
    gaps.taskInstructions === null
      ? TEXT_PLACEHOLDER
      : fill(gaps.taskInstructions, { callerCompanyName });

  return {
    mode: live ? "live" : "demo",
    script: {
      persona,
      stages: script.stages,
      lines: lines.map((line) => ({ ...line, text: fillPersona(line.text) })),
      objections: objections.map((objection) => ({
        ...objection,
        prospectLine: fillPersona(objection.prospectLine),
        callerReply: fillPersona(objection.callerReply),
      })),
      fallbackLine: { ...fallbackLine, text: fillPersona(fallbackLine.text) },
    },
    maxCallMinutes: gaps.maxCallMinutes ?? settings.demoMaxCallMinutes,
    maxCallMinutesIsDemo: gaps.maxCallMinutes === null,
    noticeText: fill(settings.recordingNotice, { retentionDays: retention }),
    clientDetails: settings.clientDetails,
    taskInstructions,
    accessCode: live ? (env.ACCESS_CODE as string) : env.ACCESS_CODE || "demo",
  };
}
