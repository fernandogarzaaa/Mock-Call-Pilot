import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { limitPassed, turnStep } from "../script/machine.ts";
import type {
  CallTurn,
  EndReason,
  LinePicker,
  ResolvedConfig,
  SessionState,
  Storage,
  Transcriber,
  Transcript,
  TurnInput,
} from "../types/index.ts";
import { PreconditionFailed, TranscribeError } from "../types/index.ts";
import { asSession, freshPractice, parsePracticeState, toPractice } from "./practice.ts";
import { callShell, messagePage, recordingPage } from "./views.ts";

export interface AppDeps {
  config: ResolvedConfig;
  storage: Storage;
  transcriber: Transcriber;
  picker: LinePicker;
  now: () => Date;
}

/** The two extra methods FsStorage offers for serving its own signed URLs. */
interface FileStore {
  verify(key: string, exp: string, sig: string): boolean;
  read(key: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
}

interface TurnResult {
  text: string;
  ended: boolean;
  endReason?: EndReason;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const MEGABYTE = 1024 * 1024;
const TURN_BODY_LIMIT = 2 * MEGABYTE;
const END_BODY_LIMIT = 25 * MEGABYTE;
const AUDIO_URL_TTL_SEC = 3600;
const MAX_NAME_LENGTH = 80;
const AUDIO_EXTENSIONS = new Map([
  ["audio/mp4", "mp4"],
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
]);

const stateKey = (id: string) => `sessions/${id}/state.json`;
const transcriptKey = (id: string) => `sessions/${id}/transcript.json`;

function codeMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string" || expected === "") return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/** Links follow the scheme the client used; Cloud Run reports it in X-Forwarded-Proto. */
function recordingUrl(c: Context, id: string): string {
  const url = new URL(c.req.url);
  const forwarded = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const scheme = forwarded === "https" || forwarded === "http" ? forwarded : url.protocol;
  return `${scheme.replace(":", "")}://${url.host}/r/${id}`;
}

/** The MIME type without parameters, so "audio/webm;codecs=opus" becomes "audio/webm". */
function baseMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

function nonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) return null;
  return Number(value);
}

function turnIndexOf(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : null;
}

async function readForm(c: Context): Promise<Record<string, unknown>> {
  try {
    return await c.req.parseBody();
  } catch (error) {
    // A malformed body is the client's mistake; anything else, such as the size limit, is not.
    if (error instanceof TypeError) return {};
    throw error;
  }
}

async function audioBytes(form: Record<string, unknown>): Promise<Uint8Array | null> {
  const file = form.audio;
  if (!(file instanceof File)) return null;
  return new Uint8Array(await file.arrayBuffer());
}

async function transcribe(t: Transcriber, audio: Uint8Array, mime: string): Promise<TurnInput> {
  try {
    return { text: await t.transcribe(audio, mime) };
  } catch (error) {
    return { sttError: error instanceof TranscribeError ? error.kind : "stt_error" };
  }
}

/** What an already-stored turn answered. Only a picker line can have ended the call. */
function storedResult(config: ResolvedConfig, turn: CallTurn): TurnResult {
  const line = config.script.lines.find((candidate) => candidate.id === turn.prospect.lineId);
  if (line?.endsCall === undefined) return { text: turn.prospect.text, ended: false };
  return { text: turn.prospect.text, ended: true, endReason: line.endsCall };
}

function decideEndReason(
  state: SessionState,
  claimed: unknown,
  maxCallMinutes: number,
  now: Date,
): EndReason | null {
  if (state.endReason !== undefined) return state.endReason;
  if (limitPassed(state, maxCallMinutes, now)) return "limit_reached";
  return claimed === "candidate_ended" || claimed === "limit_reached" ? claimed : null;
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start = Number(match[1]);
  let end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (match[1] === "") {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

function isFileStore(storage: Storage): storage is Storage & FileStore {
  return "verify" in storage && "read" in storage;
}

export function registerRoutes(app: Hono, deps: AppDeps): void {
  const { config, storage, transcriber, picker, now } = deps;
  const demo = config.mode === "demo";
  const tooLarge = (c: Context) => c.json({ error: "too_large" }, 413);
  const turnLimit = bodyLimit({ maxSize: TURN_BODY_LIMIT, onError: tooLarge });
  const endLimit = bodyLimit({ maxSize: END_BODY_LIMIT, onError: tooLarge });

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/call", async (c) => {
    if (!codeMatches(config.accessCode, c.req.query("code"))) {
      return c.html(await messagePage("Access code needed", "Check the call link.", demo), 403);
    }
    return c.html(
      await callShell({
        mode: config.mode,
        clientDetails: config.clientDetails,
        taskInstructions: config.taskInstructions,
        noticeText: config.noticeText,
        maxCallMinutes: config.maxCallMinutes,
        maxCallMinutesIsDemo: config.maxCallMinutesIsDemo,
      }),
    );
  });

  app.post("/api/sessions", async (c) => {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      // Treated like a body with no fields.
    }
    const fields: Record<string, unknown> = {};
    if (typeof body === "object" && body !== null) Object.assign(fields, body);
    if (!codeMatches(config.accessCode, fields.code)) return c.json({ error: "bad_code" }, 403);
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    if (name === "" || [...name].length > MAX_NAME_LENGTH) {
      return c.json({ error: "bad_name" }, 422);
    }

    const id = randomBytes(16).toString("base64url");
    const state: SessionState = {
      id,
      name,
      stage: config.script.stages[0] ?? "d1_attention",
      usedObjections: [],
      turns: [],
      startedAt: now().toISOString(),
    };
    await storage.putJson(stateKey(id), state, "0");
    return c.json({ id, maxCallMinutes: config.maxCallMinutes }, 201);
  });

  // Practice: same script, picker and limit as a real call, but nothing is ever stored.
  app.post("/api/practice", async (c) => {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      // Treated like a body with no fields.
    }
    const given = typeof body === "object" && body !== null ? (body as { code?: unknown }) : {};
    if (!codeMatches(config.accessCode, given.code)) return c.json({ error: "bad_code" }, 403);
    const state = freshPractice(config.script, now());
    return c.json({ state, maxCallMinutes: config.maxCallMinutes }, 201);
  });

  app.post("/api/practice/turn", turnLimit, async (c) => {
    const form = await readForm(c);
    if (!codeMatches(config.accessCode, form.code)) return c.json({ error: "bad_code" }, 403);
    const audio = await audioBytes(form);
    const clientMs = nonNegativeNumber(form.clientMs);
    const practice = parsePracticeState(form.state, config.script);
    if (audio === null || clientMs === null || practice === null) {
      return c.json({ error: "bad_request" }, 422);
    }
    if (practice.endReason !== undefined) return c.json({ error: "ended" }, 409);
    const mime = typeof form.mime === "string" && form.mime !== "" ? form.mime : "audio/webm";

    const state = asSession(practice);
    const at = now();
    const input: TurnInput = limitPassed(state, config.maxCallMinutes, at)
      ? { text: "" }
      : await transcribe(transcriber, audio, mime);
    const step = await turnStep(
      config.script,
      config.maxCallMinutes,
      state,
      input,
      clientMs,
      picker,
      at,
    );
    const result: TurnResult & { state: ReturnType<typeof toPractice> } = {
      text: step.displayText,
      ended: step.ended,
      state: toPractice(step.state),
    };
    if (step.ended) result.endReason = step.state.endReason;
    return c.json(result);
  });

  app.post("/api/s/:id/turn", turnLimit, async (c) => {
    const id = c.req.param("id");
    if (!ID_PATTERN.test(id)) return c.notFound();

    const form = await readForm(c);
    const audio = await audioBytes(form);
    const turnIndex = turnIndexOf(form.turnIndex);
    const clientMs = nonNegativeNumber(form.clientMs);
    if (audio === null || turnIndex === null || clientMs === null) {
      return c.json({ error: "bad_request" }, 422);
    }
    const mime = typeof form.mime === "string" && form.mime !== "" ? form.mime : "audio/webm";

    const loaded = await storage.getJson<SessionState>(stateKey(id));
    if (!loaded) return c.notFound();
    const { value: state, generation } = loaded;

    const stored = state.turns[turnIndex];
    if (stored) return c.json(storedResult(config, stored));
    if (state.endReason !== undefined) return c.json({ error: "ended" }, 409);
    if (turnIndex > state.turns.length) return c.json({ error: "gap" }, 409);

    const at = now();
    // Past the limit turnStep ends the call before using the input, so skip the vendor call.
    const input: TurnInput = limitPassed(state, config.maxCallMinutes, at)
      ? { text: "" }
      : await transcribe(transcriber, audio, mime);
    const step = await turnStep(
      config.script,
      config.maxCallMinutes,
      state,
      input,
      clientMs,
      picker,
      at,
    );

    try {
      await storage.putJson(stateKey(id), step.state, generation);
    } catch (error) {
      if (!(error instanceof PreconditionFailed)) throw error;
      const again = await storage.getJson<SessionState>(stateKey(id));
      const winner = again?.value.turns[turnIndex];
      if (winner) return c.json(storedResult(config, winner));
      return c.json({ error: "conflict" }, 409);
    }

    const last = step.state.turns[step.state.turns.length - 1];
    if (last?.fallbackCause !== undefined && last.index === turnIndex) {
      const entry = { event: "fallback", session: id, cause: last.fallbackCause };
      console.warn(JSON.stringify(entry));
    }
    const result: TurnResult = { text: step.displayText, ended: step.ended };
    if (step.ended) result.endReason = step.state.endReason;
    return c.json(result);
  });

  app.post("/api/s/:id/end", endLimit, async (c) => {
    const id = c.req.param("id");
    if (!ID_PATTERN.test(id)) return c.notFound();

    let loaded = await storage.getJson<SessionState>(stateKey(id));
    if (!loaded) return c.notFound();
    if (loaded.value.audio) return c.json({ url: recordingUrl(c, id) });

    const form = await readForm(c);
    const audio = await audioBytes(form);
    const mime = typeof form.mime === "string" ? baseMime(form.mime) : "";
    const extension = AUDIO_EXTENSIONS.get(mime);
    if (audio === null || extension === undefined) return c.json({ error: "bad_audio" }, 422);

    // One re-read covers a /turn or a second /end landing between our read and write.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { value: state, generation } = loaded;
      const at = now();
      const endReason = decideEndReason(state, form.reason, config.maxCallMinutes, at);
      if (endReason === null) return c.json({ error: "bad_reason" }, 422);

      const audioKey = `sessions/${id}/audio.${extension}`;
      const endedAt = at.toISOString();
      const transcript: Transcript = {
        id,
        name: state.name,
        startedAt: state.startedAt,
        endedAt,
        endReason,
        turns: state.turns,
      };
      await storage.put(audioKey, audio, mime);
      const existing = await storage.getJson<Transcript>(transcriptKey(id));
      try {
        await storage.putJson(transcriptKey(id), transcript, existing?.generation ?? "0");
        const ended: SessionState = {
          ...state,
          audio: { key: audioKey, mime },
          endReason,
          endedAt,
        };
        await storage.putJson(stateKey(id), ended, generation);
        return c.json({ url: recordingUrl(c, id) });
      } catch (error) {
        if (!(error instanceof PreconditionFailed)) throw error;
        loaded = await storage.getJson<SessionState>(stateKey(id));
        if (!loaded) return c.notFound();
        if (loaded.value.audio) return c.json({ url: recordingUrl(c, id) });
      }
    }
    return c.json({ error: "conflict" }, 409);
  });

  app.get("/r/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID_PATTERN.test(id)) return c.notFound();
    const loaded = await storage.getJson<SessionState>(stateKey(id));
    if (!loaded) return c.notFound();
    if (!loaded.value.audio) {
      const waiting = await messagePage("Call in progress", "Check back after the call.", demo);
      return c.html(waiting);
    }
    return c.html(await recordingPage(loaded.value, demo));
  });

  app.get("/r/:id/audio", async (c) => {
    const id = c.req.param("id");
    if (!ID_PATTERN.test(id)) return c.notFound();
    const loaded = await storage.getJson<SessionState>(stateKey(id));
    if (!loaded?.value.audio) return c.notFound();
    return c.redirect(await storage.readUrl(loaded.value.audio.key, AUDIO_URL_TTL_SEC), 302);
  });

  app.get("/r/:id/transcript.json", async (c) => {
    const id = c.req.param("id");
    if (!ID_PATTERN.test(id)) return c.notFound();
    const loaded = await storage.getJson<Transcript>(transcriptKey(id));
    if (!loaded) return c.notFound();
    return c.json(loaded.value);
  });

  app.get("/files/*", async (c) => {
    if (!isFileStore(storage)) return c.notFound();
    const key = c.req.path.slice("/files/".length);
    if (!storage.verify(key, c.req.query("exp") ?? "", c.req.query("sig") ?? "")) {
      return c.json({ error: "forbidden" }, 403);
    }
    const file = await storage.read(key);
    if (!file) return c.notFound();

    const total = file.bytes.byteLength;
    const headers = { "content-type": file.mime, "accept-ranges": "bytes" };
    const rangeHeader = c.req.header("range");
    if (rangeHeader === undefined) return new Response(file.bytes, { headers });
    const range = parseRange(rangeHeader, total);
    if (!range) {
      const unsatisfied = { ...headers, "content-range": `bytes */${total}` };
      return new Response(null, { status: 416, headers: unsatisfied });
    }
    const partial = {
      ...headers,
      "content-range": `bytes ${range.start}-${range.end}/${total}`,
    };
    return new Response(file.bytes.slice(range.start, range.end + 1), {
      status: 206,
      headers: partial,
    });
  });
}
