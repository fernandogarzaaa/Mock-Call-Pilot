import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakePicker } from "../picker/fake.ts";
import { FIXTURE_START, fixtureScript } from "../script/fixture.ts";
import { FsStorage } from "../storage/fs.ts";
import { FakeTranscriber } from "../stt/fake.ts";
import type {
  LinePicker,
  PickInput,
  ResolvedConfig,
  ScriptConfig,
  SessionState,
  Storage,
  Transcriber,
  Transcript,
} from "../types/index.ts";
import { PickerError, PreconditionFailed, TranscribeError } from "../types/index.ts";
import { buildApp } from "./app.ts";
import { DEMO_BANNER } from "./views.ts";

const CODE = "open-sesame";
const MINUTE = 60_000;
const MEGABYTE = 1024 * 1024;
const WALK = ["who is this", "tell me more", "we run trucks", "sounds fine", "see the invite"];
const WALK_REPLIES = [
  "FIXTURE d1.okay",
  "FIXTURE d2.next",
  "FIXTURE fc.count: FixtureCo runs 12 trucks",
  "FIXTURE d3.agree",
  "FIXTURE d4.seeinvite",
];

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A Storage that is not an FsStorage, so it has no verify/read for /files. */
function delegate(fs: FsStorage, overrides: Partial<Storage> = {}): Storage {
  return {
    put: (key, bytes, mime) => fs.put(key, bytes, mime),
    getJson: <T>(key: string) => fs.getJson<T>(key),
    putJson: (key, value, generation) => fs.putJson(key, value, generation),
    readUrl: (key, ttl) => fs.readUrl(key, ttl),
    ...overrides,
  };
}

/** Loses the next `failures` writes to state.json, as if another instance had written first. */
function flakyStorage(fs: FsStorage, flaky: { failures: number }): Storage {
  return delegate(fs, {
    putJson: async (key, value, generation) => {
      if (key.endsWith("state.json") && flaky.failures > 0) {
        flaky.failures--;
        throw new PreconditionFailed("injected");
      }
      return fs.putJson(key, value, generation);
    },
  });
}

interface Options {
  script?: ScriptConfig;
  picker?: LinePicker;
  transcriber?: Transcriber;
  config?: Partial<ResolvedConfig>;
  wrapStorage?: (fs: FsStorage) => Storage;
}

async function harness(options: Options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "mock-call-server-"));
  dirs.push(dir);
  const clock = { ms: FIXTURE_START };
  const script = options.script ?? fixtureScript;
  const config: ResolvedConfig = {
    mode: "demo",
    script,
    maxCallMinutes: 30,
    maxCallMinutesIsDemo: false,
    noticeText: "NOTICE text",
    clientDetails: "CLIENT details",
    taskInstructions: "TASK instructions",
    accessCode: CODE,
    ...options.config,
  };
  const fs = new FsStorage(dir, "test-secret", () => clock.ms);
  const storage = options.wrapStorage ? options.wrapStorage(fs) : fs;
  const app = buildApp({
    config,
    storage,
    transcriber: options.transcriber ?? new FakeTranscriber(),
    picker: options.picker ?? new FakePicker(script),
    now: () => new Date(clock.ms),
  });
  return { app, storage, clock };
}
type Harness = Awaited<ReturnType<typeof harness>>;

interface TurnBody {
  text: string;
  ended: boolean;
  endReason?: string;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function createSession(h: Harness, body: unknown): Response | Promise<Response> {
  return h.app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function start(h: Harness, name = "Ada Candidate"): Promise<string> {
  const res = await createSession(h, { code: CODE, name });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}

function turnForm(text: string, index: number, clientMs = 1000): FormData {
  const form = new FormData();
  form.append("audio", new Blob([text], { type: "audio/webm" }), "turn.webm");
  form.append("mime", "audio/webm");
  form.append("turnIndex", String(index));
  form.append("clientMs", String(clientMs));
  return form;
}

function postTurn(
  h: Harness,
  id: string,
  text: string,
  index: number,
): Response | Promise<Response> {
  return h.app.request(`/api/s/${id}/turn`, { method: "POST", body: turnForm(text, index) });
}

function endForm(reason: string, audio: string, mime: string): FormData {
  const form = new FormData();
  form.append("audio", new Blob([audio], { type: mime }), "call.bin");
  form.append("mime", mime);
  form.append("reason", reason);
  return form;
}

function postEnd(
  h: Harness,
  id: string,
  reason = "candidate_ended",
  audio = "AUDIO-ONE",
  mime = "audio/webm",
  headers: Record<string, string> = {},
): Response | Promise<Response> {
  return h.app.request(`/api/s/${id}/end`, {
    method: "POST",
    body: endForm(reason, audio, mime),
    headers,
  });
}

async function getState(h: Harness, id: string): Promise<SessionState> {
  const loaded = await h.storage.getJson<SessionState>(`sessions/${id}/state.json`);
  if (!loaded) throw new Error(`no state for ${id}`);
  return loaded.value;
}

async function getTranscript(h: Harness, id: string): Promise<Transcript> {
  return json<Transcript>(await h.app.request(`/r/${id}/transcript.json`));
}

async function pageText(h: Harness, path: string): Promise<string> {
  return (await h.app.request(path)).text();
}

async function walkToBooked(h: Harness, id: string): Promise<TurnBody[]> {
  const bodies: TurnBody[] = [];
  for (const [index, text] of WALK.entries()) {
    bodies.push(await json<TurnBody>(await postTurn(h, id, text, index)));
  }
  return bodies;
}

async function audioText(h: Harness, id: string): Promise<string> {
  const redirect = await h.app.request(`/r/${id}/audio`);
  expect(redirect.status).toBe(302);
  const file = await h.app.request(redirect.headers.get("location") ?? "");
  expect(file.status).toBe(200);
  return file.text();
}

class CountingPicker implements LinePicker {
  calls = 0;
  readonly #inner: LinePicker;

  constructor(inner: LinePicker) {
    this.#inner = inner;
  }

  async pick(input: PickInput): Promise<{ lineId: string }> {
    this.calls++;
    return this.#inner.pick(input);
  }
}

/** Holds every pick until `parties` calls are waiting, so concurrent requests truly overlap. */
function gatedPicker(inner: LinePicker, parties: number): LinePicker {
  let arrived = 0;
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async pick(input) {
      arrived++;
      if (arrived >= parties) release();
      await open;
      return inner.pick(input);
    },
  };
}

function sequencePicker(ids: string[]): LinePicker {
  let next = 0;
  return {
    async pick() {
      const lineId = ids[next] ?? "d4.seeinvite";
      next++;
      return { lineId };
    },
  };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
}

describe("a full call", () => {
  it("runs to booked and the recording page shows every turn", async () => {
    const h = await harness();
    const id = await start(h);
    const bodies = await walkToBooked(h, id);

    expect(bodies.map((body) => body.text)).toEqual(WALK_REPLIES);
    expect(bodies[0]).toEqual({ text: "FIXTURE d1.okay", ended: false });
    expect(bodies[4]).toEqual({ text: "FIXTURE d4.seeinvite", ended: true, endReason: "booked" });

    const end = await postEnd(h, id);
    expect(end.status).toBe(200);
    expect(await json<{ url: string }>(end)).toEqual({ url: `http://localhost/r/${id}` });

    const page = await h.app.request(`/r/${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const text of [...WALK, ...WALK_REPLIES]) expect(html).toContain(text);
    expect(html).toContain("Ada Candidate");
    expect(html).toContain("booked");
    expect(html).toContain(`<audio controls src="/r/${id}/audio">`);
    expect(html).not.toContain("<form");

    const transcript = await getTranscript(h, id);
    expect(transcript).toMatchObject({ id, name: "Ada Candidate", endReason: "booked" });
    expect(transcript.startedAt).toBe(new Date(FIXTURE_START).toISOString());
    expect(transcript.endedAt).toBe(new Date(FIXTURE_START).toISOString());
    expect(transcript.turns.map((turn) => turn.candidateText)).toEqual(WALK);
  });

  it("keeps the booked reason when the page also reports candidate_ended", async () => {
    const h = await harness();
    const id = await start(h);
    await walkToBooked(h, id);
    await postEnd(h, id, "candidate_ended");
    expect((await getTranscript(h, id)).endReason).toBe("booked");
  });
});

describe("starting a session", () => {
  it("answers 403 to a wrong or missing access code", async () => {
    const h = await harness();
    expect((await h.app.request("/call?code=wrong")).status).toBe(403);
    expect((await h.app.request("/call")).status).toBe(403);
    expect((await createSession(h, { code: "wrong", name: "Ada" })).status).toBe(403);
    expect((await createSession(h, { name: "Ada" })).status).toBe(403);
    expect((await createSession(h, { code: 5, name: "Ada" })).status).toBe(403);
    expect((await h.app.request(`/call?code=${CODE}`)).status).toBe(200);
  });

  it("answers 403 when the body is not JSON", async () => {
    const h = await harness();
    const res = await h.app.request("/api/sessions", { method: "POST", body: "not json" });
    expect(res.status).toBe(403);
  });

  it("accepts names of 1 to 80 characters after trimming and rejects the rest", async () => {
    const h = await harness();
    const rejected = ["", "   ", "x".repeat(81), `  ${"x".repeat(81)}`, 7, null];
    for (const name of rejected) {
      expect((await createSession(h, { code: CODE, name })).status).toBe(422);
    }
    expect((await createSession(h, { code: CODE, name: "x" })).status).toBe(201);
    expect((await createSession(h, { code: CODE, name: "x".repeat(80) })).status).toBe(201);

    const res = await createSession(h, { code: CODE, name: "  Ada  " });
    const created = await json<{ id: string; maxCallMinutes: number }>(res);
    expect(created.maxCallMinutes).toBe(30);
    expect((await getState(h, created.id)).name).toBe("Ada");
  });

  it("creates an unguessable 22-character id and a fresh state", async () => {
    const h = await harness();
    const id = await start(h);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await getState(h, id)).toEqual({
      id,
      name: "Ada Candidate",
      stage: "d1_attention",
      usedObjections: [],
      turns: [],
      startedAt: new Date(FIXTURE_START).toISOString(),
    });
  });
});

describe("the call page", () => {
  it("embeds a config block with exactly the listed keys and no caller replies", async () => {
    const h = await harness();
    const html = await pageText(h, `/call?code=${CODE}`);
    const match = /<script type="application\/json" id="cfg">(.*?)<\/script>/s.exec(html);
    expect(JSON.parse(match?.[1] ?? "null")).toEqual({
      mode: "demo",
      clientDetails: "CLIENT details",
      taskInstructions: "TASK instructions",
      noticeText: "NOTICE text",
      maxCallMinutes: 30,
      maxCallMinutesIsDemo: false,
    });
    expect(html).toContain('<main id="app"></main>');
    expect(html).toContain('<script type="module" src="/static/call.js"></script>');
    expect(html).toContain('href="/static/call.css"');
    for (const objection of fixtureScript.objections) {
      expect(html).not.toContain(objection.callerReply);
    }
  });

  it("cannot be broken out of by a hostile config text", async () => {
    const hostile = "</script><img src=x onerror=alert(1)>";
    const h = await harness({ config: { taskInstructions: hostile } });
    const html = await pageText(h, `/call?code=${CODE}`);
    expect(html).not.toContain("</script><img");
    const match = /<script type="application\/json" id="cfg">(.*?)<\/script>/s.exec(html);
    expect(JSON.parse(match?.[1] ?? "null").taskInstructions).toBe(hostile);
  });

  it("serves the static files and 404s on a missing one", async () => {
    const h = await harness();
    expect((await h.app.request("/static/call.js")).status).toBe(200);
    expect((await h.app.request("/static/call.css")).status).toBe(200);
    expect((await h.app.request("/static/missing-file.js")).status).toBe(404);
  });

  it("answers /healthz", async () => {
    const h = await harness();
    const res = await h.app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("the demo banner", () => {
  it("is on every page in demo mode and on none in live mode", async () => {
    for (const mode of ["demo", "live"] as const) {
      const h = await harness({ config: { mode } });
      const finished = await start(h);
      await postEnd(h, finished);
      const open = await start(h);
      const pages = [
        `/call?code=${CODE}`,
        "/call?code=wrong",
        `/r/${finished}`,
        `/r/${open}`,
        "/r/short",
        "/nothing-here",
      ];
      for (const path of pages) {
        const html = await pageText(h, path);
        expect(html.includes(DEMO_BANNER), `${mode} ${path}`).toBe(mode === "demo");
      }
    }
  });
});

describe("turns", () => {
  it("answers 409 ended for a new turn after the call ended", async () => {
    const h = await harness();
    const id = await start(h);
    await walkToBooked(h, id);
    const res = await postTurn(h, id, "hello again", 5);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ended" });
  });

  it("answers 409 gap when the index skips ahead, then takes the right index", async () => {
    const h = await harness();
    const id = await start(h);
    const gap = await postTurn(h, id, "hello", 1);
    expect(gap.status).toBe(409);
    expect(await gap.json()).toEqual({ error: "gap" });
    expect((await postTurn(h, id, "hello", 0)).status).toBe(200);
  });

  it("answers 404 for an unknown session and 422 for a malformed turn", async () => {
    const h = await harness();
    expect((await postTurn(h, "A".repeat(22), "hello", 0)).status).toBe(404);

    const id = await start(h);
    const send = (mutate: (form: FormData) => void) => {
      const form = turnForm("hello", 0);
      mutate(form);
      return h.app.request(`/api/s/${id}/turn`, { method: "POST", body: form });
    };
    expect((await send((f) => f.delete("audio"))).status).toBe(422);
    expect((await send((f) => f.set("audio", "not a file"))).status).toBe(422);
    expect((await send((f) => f.delete("turnIndex"))).status).toBe(422);
    expect((await send((f) => f.set("turnIndex", "-1"))).status).toBe(422);
    expect((await send((f) => f.set("turnIndex", "1.5"))).status).toBe(422);
    expect((await send((f) => f.delete("clientMs"))).status).toBe(422);
    expect((await send((f) => f.set("clientMs", "soon"))).status).toBe(422);
    expect((await send(() => undefined)).status).toBe(200);
  });

  it("returns the stored result for a replayed index without picking again", async () => {
    const picker = new CountingPicker(new FakePicker(fixtureScript));
    const h = await harness({ picker });
    const id = await start(h);
    const first = await json<TurnBody>(await postTurn(h, id, "who is this", 0));
    const again = await json<TurnBody>(await postTurn(h, id, "other words entirely", 0));
    expect(again).toEqual(first);
    expect(picker.calls).toBe(1);
    const state = await getState(h, id);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.candidateText).toBe("who is this");
  });

  it("replays the turn that ended the call, with its end reason", async () => {
    const picker = new CountingPicker(new FakePicker(fixtureScript));
    const h = await harness({ picker });
    const id = await start(h);
    await walkToBooked(h, id);
    const replay = await postTurn(h, id, "see the invite", 4);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      text: "FIXTURE d4.seeinvite",
      ended: true,
      endReason: "booked",
    });
    const earlier = await json<TurnBody>(await postTurn(h, id, "who is this", 0));
    expect(earlier).toEqual({ text: "FIXTURE d1.okay", ended: false });
    expect(picker.calls).toBe(5);
  });

  it("stores one turn and answers two concurrent identical turns alike", async () => {
    const picker = gatedPicker(new FakePicker(fixtureScript), 2);
    const h = await harness({ picker });
    const id = await start(h);
    const [a, b] = await Promise.all([
      postTurn(h, id, "who is this", 0),
      postTurn(h, id, "who is this", 0),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bodyA = await json<TurnBody>(a);
    expect(bodyA).toEqual({ text: "FIXTURE d1.okay", ended: false });
    expect(await json<TurnBody>(b)).toEqual(bodyA);
    expect((await getState(h, id)).turns).toHaveLength(1);
  });

  it("lets one of two different turns racing for an index win and replays it", async () => {
    const picker = gatedPicker(new FakePicker(fixtureScript), 2);
    const h = await harness({ picker });
    const id = await start(h);
    const [a, b] = await Promise.all([
      postTurn(h, id, "first words", 0),
      postTurn(h, id, "second words", 0),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await json<TurnBody>(a)).toEqual(await json<TurnBody>(b));
    const turns = (await getState(h, id)).turns;
    expect(turns).toHaveLength(1);
    expect(["first words", "second words"]).toContain(turns[0]?.candidateText);
  });

  it("answers 409 conflict when the write is lost and no turn was stored", async () => {
    const flaky = { failures: 0 };
    const h = await harness({ wrapStorage: (fs) => flakyStorage(fs, flaky) });
    const id = await start(h);
    flaky.failures = 1;
    const res = await postTurn(h, id, "hello", 0);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
    expect((await getState(h, id)).turns).toHaveLength(0);
    expect((await postTurn(h, id, "hello", 0)).status).toBe(200);
  });

  it("answers 500 and keeps the details to itself when storage breaks", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenReads = (fs: FsStorage): Storage => {
      return delegate(fs, {
        getJson: async () => {
          throw new Error("disk on fire");
        },
      });
    };
    const h = await harness({ wrapStorage: brokenReads });
    const id = await start(h);
    const res = await postTurn(h, id, "hello", 0);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("records a transcription failure as a fallback turn and keeps the call going", async () => {
    const transcriber: Transcriber = {
      async transcribe() {
        throw new TranscribeError("stt_timeout");
      },
    };
    const h = await harness({ transcriber });
    const id = await start(h);
    const body = await json<TurnBody>(await postTurn(h, id, "hello", 0));
    expect(body).toEqual({ text: "FIXTURE fallback", ended: false });
    const state = await getState(h, id);
    expect(state.stage).toBe("d1_attention");
    expect(state.turns[0]).toMatchObject({ candidateText: "", fallbackCause: "stt_timeout" });

    await postEnd(h, id);
    const html = await pageText(h, `/r/${id}`);
    expect(html).toContain('data-cause="stt_timeout"');
    expect(html).toContain("[not understood: stt_timeout]");
  });

  it("treats other transcriber failures as stt_error and blank speech as empty", async () => {
    const broken: Transcriber = {
      async transcribe() {
        throw new Error("vendor exploded");
      },
    };
    const h = await harness({ transcriber: broken });
    const id = await start(h);
    await postTurn(h, id, "hello", 0);
    expect((await getState(h, id)).turns[0]?.fallbackCause).toBe("stt_error");

    const blank = await harness();
    const blankId = await start(blank);
    const body = await json<TurnBody>(await postTurn(blank, blankId, "   ", 0));
    expect(body.text).toBe("FIXTURE fallback");
    expect((await getState(blank, blankId)).turns[0]?.fallbackCause).toBe("empty");
  });

  it("marks a picker failure on the page without calling the words not understood", async () => {
    const failing: LinePicker = {
      async pick() {
        throw new PickerError("picker_timeout");
      },
    };
    const h = await harness({ picker: failing });
    const id = await start(h);
    await postTurn(h, id, "can you hear me", 0);
    await postEnd(h, id);
    const html = await pageText(h, `/r/${id}`);
    expect(html).toContain('data-cause="picker_timeout"');
    expect(html).toContain("can you hear me");
    expect(html).not.toContain("not understood");
  });

  it("rejects a turn body over 2 MB with 413 and takes one of 1 MB", async () => {
    const h = await harness();
    const id = await start(h);
    const tooBig = await h.app.request(`/api/s/${id}/turn`, {
      method: "POST",
      body: turnForm("hello", 0),
      headers: { "content-length": String(2 * MEGABYTE + 1) },
    });
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: "too_large" });

    const form = turnForm("hello", 0);
    form.set("audio", new Blob([new Uint8Array(MEGABYTE)], { type: "audio/webm" }), "turn.webm");
    const fits = await h.app.request(`/api/s/${id}/turn`, { method: "POST", body: form });
    expect(fits.status).toBe(200);
  });
});

describe("the time limit", () => {
  it("ends the call through /turn without a vendor call or a new turn", async () => {
    let transcribed = 0;
    const transcriber: Transcriber = {
      async transcribe(audio, mime) {
        transcribed++;
        return new FakeTranscriber().transcribe(audio, mime);
      },
    };
    const h = await harness({ transcriber, config: { maxCallMinutes: 1 } });
    const id = await start(h);
    h.clock.ms += MINUTE + 1;

    const res = await postTurn(h, id, "hello", 0);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "", ended: true, endReason: "limit_reached" });
    expect(transcribed).toBe(0);
    const state = await getState(h, id);
    expect(state.endReason).toBe("limit_reached");
    expect(state.turns).toHaveLength(0);

    expect((await postTurn(h, id, "hello", 0)).status).toBe(409);
    await postEnd(h, id);
    expect((await getTranscript(h, id)).endReason).toBe("limit_reached");
  });

  it("lets a turn through at exactly the limit", async () => {
    const h = await harness({ config: { maxCallMinutes: 1 } });
    const id = await start(h);
    h.clock.ms += MINUTE;
    const body = await json<TurnBody>(await postTurn(h, id, "hello", 0));
    expect(body).toEqual({ text: "FIXTURE d1.okay", ended: false });
  });

  it("decides limit_reached itself on /end whatever the page claims", async () => {
    const h = await harness({ config: { maxCallMinutes: 1 } });
    const id = await start(h);
    await postTurn(h, id, "hello", 0);
    h.clock.ms += MINUTE + 1;
    await postEnd(h, id, "candidate_ended");
    const transcript = await getTranscript(h, id);
    expect(transcript.endReason).toBe("limit_reached");
    expect(transcript.turns).toHaveLength(1);
    expect(transcript.endedAt).toBe(new Date(h.clock.ms).toISOString());
  });
});

describe("ending the call", () => {
  it("accepts candidate_ended and limit_reached from the page", async () => {
    for (const reason of ["candidate_ended", "limit_reached"]) {
      const h = await harness();
      const id = await start(h);
      expect((await postEnd(h, id, reason)).status).toBe(200);
      expect((await getTranscript(h, id)).endReason).toBe(reason);
      expect((await getState(h, id)).endReason).toBe(reason);
    }
  });

  it("refuses to let the page set booked or prospect_ended", async () => {
    const h = await harness();
    const id = await start(h);
    for (const reason of ["booked", "prospect_ended", "", "nonsense"]) {
      const res = await postEnd(h, id, reason);
      expect(res.status).toBe(422);
    }
    expect((await getState(h, id)).audio).toBeUndefined();
    expect(await pageText(h, `/r/${id}`)).toContain("Call in progress");
    expect((await postEnd(h, id, "candidate_ended")).status).toBe(200);
  });

  it("returns the same URL for a repeated /end and leaves the audio alone", async () => {
    const h = await harness();
    const id = await start(h);
    const firstRes = await postEnd(h, id, "candidate_ended", "AUDIO-ONE");
    const first = await json<{ url: string }>(firstRes);
    const again = await postEnd(h, id, "candidate_ended", "AUDIO-TWO", "audio/mp4");
    expect(again.status).toBe(200);
    expect(await json<{ url: string }>(again)).toEqual(first);
    expect(await audioText(h, id)).toBe("AUDIO-ONE");
    const redirect = await h.app.request(`/r/${id}/audio`);
    expect(redirect.headers.get("location")).toContain("/audio.webm?");
  });

  it("retries /end once after a lost write and gives up after a second one", async () => {
    const flaky = { failures: 0 };
    const h = await harness({ wrapStorage: (fs) => flakyStorage(fs, flaky) });
    const id = await start(h);

    flaky.failures = 2;
    const lost = await postEnd(h, id);
    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: "conflict" });
    expect((await getState(h, id)).audio).toBeUndefined();

    flaky.failures = 1;
    const won = await postEnd(h, id);
    expect(won.status).toBe(200);
    expect((await getState(h, id)).audio?.key).toBe(`sessions/${id}/audio.webm`);
    expect((await getTranscript(h, id)).endReason).toBe("candidate_ended");
  });

  it("names the audio file after the recorded MIME type", async () => {
    const cases = [
      ["audio/mp4", "audio.mp4"],
      ["audio/webm;codecs=opus", "audio.webm"],
      ["audio/ogg;codecs=opus", "audio.ogg"],
      ["AUDIO/WEBM", "audio.webm"],
    ];
    for (const [mime, file] of cases) {
      const h = await harness();
      const id = await start(h);
      expect((await postEnd(h, id, "candidate_ended", "bytes", mime)).status).toBe(200);
      const redirect = await h.app.request(`/r/${id}/audio`);
      expect(redirect.headers.get("location")).toContain(`/files/sessions/${id}/${file}?`);
      const stored = await h.app.request(redirect.headers.get("location") ?? "");
      expect(stored.headers.get("content-type")).toBe(mime.split(";")[0]?.toLowerCase());
    }
  });

  it("answers 422 for an unsupported MIME type or a missing audio part", async () => {
    const h = await harness();
    const id = await start(h);
    expect((await postEnd(h, id, "candidate_ended", "bytes", "audio/mpeg")).status).toBe(422);
    expect((await postEnd(h, id, "candidate_ended", "bytes", "")).status).toBe(422);
    expect((await postEnd(h, id, "candidate_ended", "bytes", "constructor")).status).toBe(422);
    const noAudio = new FormData();
    noAudio.append("mime", "audio/webm");
    noAudio.append("reason", "candidate_ended");
    const res = await h.app.request(`/api/s/${id}/end`, { method: "POST", body: noAudio });
    expect(res.status).toBe(422);
    expect((await getState(h, id)).audio).toBeUndefined();
  });

  it("rejects an /end body over 25 MB with 413", async () => {
    const h = await harness();
    const id = await start(h);
    const res = await postEnd(h, id, "candidate_ended", "bytes", "audio/webm", {
      "content-length": String(25 * MEGABYTE + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("builds the link from X-Forwarded-Proto when it is http or https", async () => {
    const cases: [string | undefined, string][] = [
      ["https", "https"],
      ["https, http", "https"],
      ["http", "http"],
      ["ftp", "http"],
      [undefined, "http"],
    ];
    for (const [forwarded, scheme] of cases) {
      const h = await harness();
      const id = await start(h);
      const headers: Record<string, string> = {};
      if (forwarded !== undefined) headers["x-forwarded-proto"] = forwarded;
      const res = await postEnd(h, id, "candidate_ended", "bytes", "audio/webm", headers);
      expect(await json<{ url: string }>(res)).toEqual({ url: `${scheme}://localhost/r/${id}` });
    }
  });
});

describe("the recording page", () => {
  it("says the call is in progress before /end and hides audio and transcript", async () => {
    const h = await harness();
    const id = await start(h);
    await postTurn(h, id, "who is this", 0);
    const page = await h.app.request(`/r/${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Call in progress");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("who is this");
    expect((await h.app.request(`/r/${id}/audio`)).status).toBe(404);
    expect((await h.app.request(`/r/${id}/transcript.json`)).status).toBe(404);
  });

  it("redirects /audio to a fresh URL that lasts one hour", async () => {
    const h = await harness();
    const id = await start(h);
    await postEnd(h, id);
    const res = await h.app.request(`/r/${id}/audio`);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "", "http://localhost");
    expect(location.pathname).toBe(`/files/sessions/${id}/audio.webm`);
    const expected = Math.ceil(FIXTURE_START / 1000) + 3600;
    expect(location.searchParams.get("exp")).toBe(String(expected));

    h.clock.ms += 10 * MINUTE;
    const later = await h.app.request(`/r/${id}/audio`);
    const laterUrl = new URL(later.headers.get("location") ?? "", "http://localhost");
    expect(laterUrl.searchParams.get("exp")).toBe(String(expected + 600));
    const file = await h.app.request(laterUrl.pathname + laterUrl.search);
    expect(await file.text()).toBe("AUDIO-ONE");
  });

  it("carries a script that retries the audio once after an expired URL", async () => {
    const h = await harness();
    const id = await start(h);
    await postEnd(h, id);
    const html = await pageText(h, `/r/${id}`);
    expect(html).toContain('audio.addEventListener("error"');
    expect(html).toContain("audio.dataset.retried");
  });

  it("shows the approved reply on the page and never during the call", async () => {
    const script: ScriptConfig = {
      ...fixtureScript,
      objections: [
        ...fixtureScript.objections,
        {
          id: "obj.sendinfo",
          prospectLine: "TEST sendinfo PROSPECT-LINE",
          callerReply: "TEST sendinfo CALLER-REPLY",
          allowedStages: ["d2_lawsuit"],
          approved: true,
        },
      ],
    };
    const h = await harness({ script, picker: sequencePicker(["d1.okay", "obj.sendinfo"]) });
    const id = await start(h);
    const first = await postTurn(h, id, "who is this", 0);
    const second = await postTurn(h, id, "let me explain", 1);
    const shown = [await first.text(), await second.text()];
    expect(shown[1]).toContain("TEST sendinfo PROSPECT-LINE");
    for (const text of shown) expect(text).not.toContain("CALLER-REPLY");
    expect((await getState(h, id)).stage).toBe("d2_lawsuit");
    expect(await pageText(h, `/call?code=${CODE}`)).not.toContain("CALLER-REPLY");

    await postEnd(h, id);
    const html = await pageText(h, `/r/${id}`);
    expect(html).toContain("Approved reply (for reviewer)");
    expect(html).toContain("TEST sendinfo CALLER-REPLY");

    const plain = await harness();
    const plainId = await start(plain);
    await postTurn(plain, plainId, "who is this", 0);
    await postEnd(plain, plainId);
    expect(await pageText(plain, `/r/${plainId}`)).not.toContain("Approved reply");
  });

  it("escapes the candidate's name and words", async () => {
    const h = await harness();
    const id = await start(h, "<script>alert(1)</script>");
    await postTurn(h, id, "<b>bold</b>", 0);
    await postEnd(h, id);
    const html = await pageText(h, `/r/${id}`);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});

describe("ids and routes", () => {
  it("answers 404 for an id that is not 22 URL-safe characters", async () => {
    const h = await harness();
    const bad = [
      "short",
      "a".repeat(21),
      "a".repeat(23),
      `${"a".repeat(21)}!`,
      `${"a".repeat(21)}.`,
    ];
    for (const id of bad) {
      for (const path of [`/r/${id}`, `/r/${id}/audio`, `/r/${id}/transcript.json`]) {
        expect((await h.app.request(path)).status, path).toBe(404);
      }
      const turn = await postTurn(h, id, "x", 0);
      expect(turn.status).toBe(404);
      expect(await turn.json()).toEqual({ error: "not_found" });
      expect((await postEnd(h, id)).status).toBe(404);
    }
  });

  it("answers 404 for a well-formed id that was never started", async () => {
    const h = await harness();
    const id = "B".repeat(22);
    for (const path of [`/r/${id}`, `/r/${id}/audio`, `/r/${id}/transcript.json`]) {
      expect((await h.app.request(path)).status, path).toBe(404);
    }
    expect((await postEnd(h, id)).status).toBe(404);
  });
});

describe("serving files from fs storage", () => {
  async function ended() {
    const h = await harness();
    const id = await start(h);
    await postEnd(h, id, "candidate_ended", "0123456789");
    const redirect = await h.app.request(`/r/${id}/audio`);
    const location = new URL(redirect.headers.get("location") ?? "", "http://localhost");
    return { h, location, path: location.pathname + location.search };
  }

  it("serves a signed URL and refuses a tampered or expired one", async () => {
    const { h, location, path } = await ended();
    const exp = location.searchParams.get("exp") ?? "";
    const sig = location.searchParams.get("sig") ?? "";
    const good = await h.app.request(path);
    expect(good.status).toBe(200);
    expect(await good.text()).toBe("0123456789");

    const tampered = `${location.pathname}?exp=${exp}&sig=${sig.slice(1)}x`;
    expect((await h.app.request(tampered)).status).toBe(403);
    expect((await h.app.request(`${location.pathname}?exp=${exp}`)).status).toBe(403);
    expect((await h.app.request(location.pathname)).status).toBe(403);

    h.clock.ms += 3601 * 1000;
    expect((await h.app.request(path)).status).toBe(403);
  });

  it("answers byte ranges so the player can seek", async () => {
    const { h, path } = await ended();
    const range = async (value: string) => h.app.request(path, { headers: { range: value } });

    const middle = await range("bytes=2-5");
    expect(middle.status).toBe(206);
    expect(middle.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await middle.text()).toBe("2345");

    const open = await range("bytes=7-");
    expect(open.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await open.text()).toBe("789");

    const suffix = await range("bytes=-3");
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await suffix.text()).toBe("789");

    const clamped = await range("bytes=8-99");
    expect(clamped.headers.get("content-range")).toBe("bytes 8-9/10");

    const beyond = await range("bytes=10-12");
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe("bytes */10");
    expect((await range("bytes=-")).status).toBe(416);
    expect((await range("pages=1-2")).status).toBe(416);

    const whole = await h.app.request(path);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-type")).toBe("audio/webm");
  });

  it("does not serve /files when the storage cannot sign its own URLs", async () => {
    const h = await harness({ wrapStorage: (fs) => delegate(fs) });
    const id = await start(h);
    await postEnd(h, id);
    const redirect = await h.app.request(`/r/${id}/audio`);
    const res = await h.app.request(redirect.headers.get("location") ?? "");
    expect(res.status).toBe(404);
  });
});

describe("G1 at the HTTP boundary", () => {
  it("only ever shows approved text", { timeout: 30_000 }, async () => {
    const approved = new Set<string>([
      ...fixtureScript.lines.map((line) => line.text),
      ...fixtureScript.objections.map((objection) => objection.prospectLine),
      fixtureScript.fallbackLine.text,
    ]);
    const random = seeded(2026);
    const junk = ["", "nonsense", "FIXTURE d1.okay", "d4.seeinvite", "obj.pitchonly", "__proto__"];
    const chaos: LinePicker = {
      async pick(input) {
        const roll = random();
        if (roll < 0.2) throw new Error("boom");
        if (roll < 0.35) throw new PickerError("picker_timeout");
        if (roll < 0.6) return { lineId: junk[Math.floor(random() * junk.length)] ?? "" };
        const options = input.allowed;
        return { lineId: options[Math.floor(random() * options.length)]?.id ?? "" };
      },
    };

    const h = await harness({ picker: chaos });
    let fallbacks = 0;
    let lines = 0;
    for (let session = 0; session < 15; session++) {
      const id = await start(h);
      for (let index = 0; index < 60; index++) {
        const res = await postTurn(h, id, `words ${index}`, index);
        expect(res.status).toBe(200);
        const body = await json<TurnBody>(res);
        expect(approved.has(body.text), body.text).toBe(true);
        if (body.text === fixtureScript.fallbackLine.text) fallbacks++;
        else lines++;
        if (body.ended) break;
      }
    }
    expect(fallbacks).toBeGreaterThan(0);
    expect(lines).toBeGreaterThan(0);
  });
});

describe("concurrency", () => {
  it("keeps 20 simultaneous sessions apart: own markers, own audio, own link", async () => {
    const h = await harness();
    const SESSIONS = 20;
    const run = async (n: number) => {
      const id = await start(h, `Candidate ${n}`);
      const markers = [`marker-${n}-a`, `marker-${n}-b`, `marker-${n}-c`];
      for (const [index, marker] of markers.entries()) {
        const res = await postTurn(h, id, marker, index);
        expect(res.status).toBe(200);
      }
      const end = await postEnd(h, id, "candidate_ended", `audio-${n}`);
      expect(end.status).toBe(200);
      return { id, n, markers, url: (await json<{ url: string }>(end)).url };
    };
    const results = await Promise.all(Array.from({ length: SESSIONS }, (_, n) => run(n)));

    expect(new Set(results.map((result) => result.id)).size).toBe(SESSIONS);
    for (const { id, n, markers, url } of results) {
      expect(url).toBe(`http://localhost/r/${id}`);
      const transcript = await getTranscript(h, id);
      expect(transcript.id).toBe(id);
      expect(transcript.name).toBe(`Candidate ${n}`);
      expect(transcript.turns.map((turn) => turn.candidateText)).toEqual(markers);
      expect(transcript.turns.every((turn) => turn.fallbackCause === undefined)).toBe(true);
      expect(await audioText(h, id)).toBe(`audio-${n}`);
      const page = await pageText(h, `/r/${id}`);
      for (const marker of markers) expect(page).toContain(marker);
      for (const other of results.filter((result) => result.n !== n)) {
        for (const marker of other.markers) expect(page).not.toContain(`${marker}<`);
      }
    }
  });
});
