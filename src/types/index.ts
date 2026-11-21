export type Stage = "d1_attention" | "d2_lawsuit" | "fleet_check" | "d3_pitch" | "d4_schedule";
export type EndReason = "booked" | "prospect_ended" | "limit_reached" | "candidate_ended";
export type FallbackCause =
  | "stt_error"
  | "stt_timeout"
  | "empty"
  | "picker_error"
  | "picker_timeout"
  | "picker_refusal"
  | "picker_invalid_id";
export const VENDOR_CAUSES: readonly FallbackCause[] = [
  "stt_error",
  "stt_timeout",
  "picker_error",
  "picker_timeout",
  "picker_refusal",
];

export interface Line {
  id: string;
  stage: Stage;
  text: string;
  nextStage: Stage;
  approved: boolean;
  endsCall?: "booked" | "prospect_ended";
}
export interface Objection {
  id: string;
  prospectLine: string;
  callerReply: string;
  allowedStages: Stage[];
  approved: boolean;
}
export interface Persona {
  firstName: string | null;
  companyName: string | null;
  fleetSize: number | null;
}
export interface ScriptConfig {
  persona: Persona;
  stages: Stage[];
  lines: Line[];
  objections: Objection[];
  fallbackLine: { text: string; approved: boolean };
}

export interface PilotGaps {
  interviewFlow: string | null;
  testWindow: string | null;
  retentionDays: number | null;
  sourceLiveTest: string | null;
  taskInstructions: string | null;
  callerCompanyName: string | null;
  maxCallMinutes: number | null;
}
export interface PilotSettings {
  recordingNotice: string;
  clientDetails: string;
  demoMaxCallMinutes: number;
}
export interface PilotConfig {
  gaps: PilotGaps;
  settings: PilotSettings;
}

/** Produced by loadConfig: everything already substituted, ready to display. */
export interface ResolvedConfig {
  mode: "live" | "demo";
  /** Persona tokens already filled in every text. */
  script: ScriptConfig;
  maxCallMinutes: number;
  /** True when maxCallMinutes came from settings.demoMaxCallMinutes. */
  maxCallMinutesIsDemo: boolean;
  /** {retentionDays} filled. */
  noticeText: string;
  clientDetails: string;
  /** {callerCompanyName} filled. */
  taskInstructions: string;
  accessCode: string;
}

export interface CallTurn {
  /** 0-based; the next expected index equals turns.length. */
  index: number;
  /** Milliseconds since Start, measured by the page. */
  clientMs: number;
  /** "" when not understood. */
  candidateText: string;
  fallbackCause?: FallbackCause;
  prospect: { lineId: string | null; text: string; callerReply?: string };
}
export interface SessionState {
  id: string;
  name: string;
  stage: Stage;
  usedObjections: string[];
  turns: CallTurn[];
  startedAt: string;
  endedAt?: string;
  endReason?: EndReason;
  audio?: { key: string; mime: string };
}

/** Served at GET /r/:id/transcript.json. */
export interface Transcript {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  endReason: EndReason;
  turns: CallTurn[];
}
export type TurnBase = Pick<CallTurn, "index" | "clientMs" | "candidateText">;

export interface Storage {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  getJson<T>(key: string): Promise<{ value: T; generation: string } | null>;
  /** ifGeneration "0" means create only if absent. Returns the new generation. Throws PreconditionFailed. */
  putJson(key: string, value: unknown, ifGeneration: string): Promise<string>;
  readUrl(key: string, ttlSec: number): Promise<string>;
}

export type TurnInput = { text: string } | { sttError: "stt_error" | "stt_timeout" };
export interface Transcriber {
  transcribe(audio: Uint8Array, mime: string): Promise<string>;
}
export interface PickInput {
  stage: Stage;
  /** Completed turns only, at most 6, oldest first. */
  recentTurns: CallTurn[];
  /** What the candidate just said (non-empty). */
  candidateText: string;
  allowed: { id: string; text: string }[];
}
export interface LinePicker {
  pick(input: PickInput): Promise<{ lineId: string }>;
}

export class PreconditionFailed extends Error {}
export class NotFound extends Error {}
export class PickerError extends Error {
  readonly kind: "picker_error" | "picker_timeout" | "picker_refusal";
  constructor(kind: PickerError["kind"]) {
    super(kind);
    this.kind = kind;
  }
}
export class TranscribeError extends Error {
  readonly kind: "stt_error" | "stt_timeout";
  /** What the vendor answered, for the server log only. Never shown to a candidate. */
  readonly detail: string;
  constructor(kind: TranscribeError["kind"], detail = "") {
    super(kind);
    this.kind = kind;
    this.detail = detail;
  }
}
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.problems = problems;
  }
}
