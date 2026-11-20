// Pure logic for the call page. No DOM, so vitest can run it under plain Node.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const NAME_MAX = 80;
export const LOST_MESSAGE = "Connection lost. Check your connection and press Done again";
export const NOT_SAVED_MESSAGE = "That turn could not be saved. Press Done to try again.";

// Chrome and Safari record MP4 and its duration is readable; Chrome's WebM has none.
const MIME_PREFERENCE = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"];

const EXTENSIONS = { "audio/mp4": "mp4", "audio/webm": "webm", "audio/ogg": "ogg" };

/** The first supported recording type, or null when the browser supports none of them. */
export function pickMimeType(isTypeSupported) {
  for (const type of MIME_PREFERENCE) {
    if (isTypeSupported(type)) return type;
  }
  return null;
}

/** File extension for a recorded type; parameters such as ";codecs=opus" are ignored. */
export function recordingExtension(mime) {
  const base = String(mime).split(";")[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? "bin";
}

/** True for a name the server accepts: 1 to 80 characters after trimming. */
export function validName(name) {
  if (typeof name !== "string") return false;
  const length = [...name.trim()].length;
  return length >= 1 && length <= NAME_MAX;
}

export function tooLargeToUpload(bytes) {
  return bytes > MAX_UPLOAD_BYTES;
}

// screen -> event type -> next screen. Guards for the events that need input are in nextScreen.
const TRANSITIONS = {
  name: { submit: "brief" },
  brief: { accept: "mic" },
  mic: { granted: "ready", skip: "ready" },
  ready: { practice: "practice", final: "confirm", mic: "mic" },
  practice: { end: "ready" },
  confirm: { start: "call", back: "ready" },
  call: { end: "uploading" },
  uploading: { uploaded: "done", failed: "retry" },
  retry: { retry: "uploading" },
  done: {},
};

/**
 * The screen order is name, brief, mic, ready, confirm, call, uploading, done, plus uploading
 * to retry. From ready the candidate can also run practice calls and come back to ready.
 * An event that does not apply, or whose guard fails, leaves the screen unchanged.
 */
export function nextScreen(screen, event) {
  const type = event?.type;
  const row = Object.hasOwn(TRANSITIONS, screen) ? TRANSITIONS[screen] : {};
  const next = Object.hasOwn(row, type) ? row[type] : undefined;
  if (next === undefined) return screen;
  if (screen === "name" && !validName(event.name)) return screen;
  if (screen === "brief" && event.noticeTicked !== true) return screen;
  // Skipping the microphone is a test path: only where the page says typed turns are allowed.
  if (screen === "mic" && type === "skip" && event.textAllowed !== true) return screen;
  // The final call is recorded, so it cannot be reached without a microphone.
  if (screen === "ready" && type === "final" && event.hasMic !== true) return screen;
  // The final call starts only from the confirm screen, after the candidate ticks the box.
  if (screen === "confirm" && type === "start" && event.confirmed !== true) return screen;
  return next;
}

/**
 * The buttons on a call screen. Practice can be redone; the final call is one attempt.
 * A practice call without a microphone (the typed test path) swaps Speak and Done for Send.
 */
export function callControls(screen, typed = false) {
  if (screen === "practice" && typed) return ["send", "redo", "end"];
  if (screen === "practice") return ["speak", "done", "redo", "end"];
  if (screen === "call") return ["speak", "done", "end"];
  return [];
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POSTs the form, retrying only network errors and 5xx answers, waiting 1 s then 2 s.
 * Returns the last response (a 5xx one if every attempt got a 5xx) or throws the last network error.
 */
export async function postWithRetry(fetchFn, url, form, attempts = 3, sleep = defaultSleep) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchFn(url, { method: "POST", body: form });
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
      continue;
    }
    if (response.status < 500 || attempt >= attempts) return response;
    await sleep(1000 * 2 ** (attempt - 1));
  }
}

/**
 * What the page does after a failed turn request. Status 0 means the network failed.
 * A gap or conflict is resent once with the same index; `resent` says that already happened.
 */
export function onTurnError(status, body, resent = false) {
  if (status === 409 && body?.error === "ended") return { action: "upload" };
  const retryable = body?.error === "gap" || body?.error === "conflict";
  if (status === 409 && retryable && !resent) return { action: "resend" };
  // The server answered, so the connection is fine: say the turn was not saved.
  if (status >= 400 && status < 500) return { action: "lost", message: NOT_SAVED_MESSAGE };
  return { action: "lost", message: LOST_MESSAGE };
}

/** "m:ss", rounded up so the clock shows 0:00 only once time has run out. */
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export const STEPS = ["Your name", "Briefing", "Microphone", "Practice", "Final call"];

const STEP_OF = {
  name: 0,
  brief: 1,
  mic: 2,
  ready: 3,
  practice: 3,
  confirm: 4,
  call: 4,
  uploading: 4,
  retry: 4,
  done: 4,
};

/** Where a screen sits in the five steps: its 0-based index, and whether the flow is finished. */
export function stepFor(screen) {
  const index = Object.hasOwn(STEP_OF, screen) ? STEP_OF[screen] : 0;
  return { index, finished: screen === "done" };
}

// The demo transcriber echoes a turn only when it is under 200 bytes, so typed turns stay below.
export const TYPED_TURN_MAX_BYTES = 190;

/** The bytes of a typed practice turn, or null when it is blank or too long to be echoed. */
export function typedTurnBytes(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") return null;
  const bytes = new TextEncoder().encode(trimmed);
  return bytes.byteLength > TYPED_TURN_MAX_BYTES ? null : bytes;
}

/**
 * What the candidate is doing on a call screen, which decides the one main button shown:
 * Speak when idle, Done while listening or when a turn must be sent again, none while busy.
 */
export function callPhase({ finishing, busy, listening, pending }) {
  if (finishing) return "ending";
  if (busy) return "sending";
  if (listening) return "listening";
  if (pending) return "resend";
  return "idle";
}
