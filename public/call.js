import {
  formatRemaining,
  NAME_MAX,
  nextScreen,
  onTurnError,
  pickMimeType,
  postWithRetry,
  recordingExtension,
  tooLargeToUpload,
} from "./call-core.js";

const AUDIO_BITS_PER_SECOND = 32000;
const LAST_LINE_MS = 3000;
const cfg = JSON.parse(document.getElementById("cfg").textContent);
const app = document.getElementById("app");
const code = new URLSearchParams(location.search).get("code") ?? "";

const state = {
  screen: "name",
  name: "",
  ticked: false,
  error: "",
  status: "",
  stream: null,
  mimeType: null,
  id: null,
  limitMs: 0,
  startedAt: 0,
  full: null,
  turn: null,
  pending: null,
  turnIndex: 0,
  lines: [],
  busy: null,
  finishing: false,
  reason: "candidate_ended",
  timer: null,
  blob: null,
  tooLarge: false,
  link: "",
};
let ui = {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Text always goes in through textContent, so config text can never be parsed as markup.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}

function limitLabel() {
  const minutes = `${cfg.maxCallMinutes} minutes`;
  return cfg.maxCallMinutesIsDemo ? `${minutes} (demo limit)` : minutes;
}

function go(event) {
  const next = nextScreen(state.screen, event);
  if (next === state.screen) return false;
  state.screen = next;
  render();
  return true;
}

function render() {
  ui = {};
  app.replaceChildren(views[state.screen]());
}

function errorLine() {
  return h("p", { className: "error", role: "alert" }, state.error);
}

const views = {
  name() {
    const input = h("input", {
      id: "name",
      type: "text",
      maxLength: NAME_MAX,
      autocomplete: "name",
      value: state.name,
    });
    const form = h(
      "form",
      {
        onsubmit(event) {
          event.preventDefault();
          state.name = input.value;
          state.error = "";
          if (!go({ type: "submit", name: state.name })) {
            state.error = `Enter your name (1 to ${NAME_MAX} characters).`;
            render();
          }
        },
      },
      h("label", { htmlFor: "name" }, "Your name"),
      input,
      errorLine(),
      h("button", { type: "submit", className: "primary" }, "Continue"),
    );
    queueMicrotask(() => input.focus());
    return h("section", {}, h("h1", {}, "Mock call"), form);
  },

  brief() {
    const next = h(
      "button",
      {
        type: "button",
        className: "primary",
        disabled: !state.ticked,
        onclick: () => go({ type: "accept", noticeTicked: state.ticked }),
      },
      "Continue",
    );
    const tick = h("input", {
      id: "notice-tick",
      type: "checkbox",
      checked: state.ticked,
      onchange(event) {
        state.ticked = event.target.checked;
        next.disabled = !state.ticked;
      },
    });
    return h(
      "section",
      {},
      h("h1", {}, "Before you start"),
      h("h2", {}, "The client"),
      h("p", { className: "text" }, cfg.clientDetails),
      h("h2", {}, "Your task"),
      h("p", { className: "text" }, cfg.taskInstructions),
      h("p", {}, `Time limit: ${limitLabel()}.`),
      h("h2", {}, "Recording notice"),
      h("p", { className: "text notice" }, cfg.noticeText),
      h(
        "div",
        { className: "tick" },
        tick,
        h("label", { htmlFor: "notice-tick" }, "I understand this call is recorded"),
      ),
      next,
    );
  },

  mic() {
    return h(
      "section",
      {},
      h("h1", {}, "Microphone"),
      h("p", {}, "Allow the microphone so the call can be recorded."),
      errorLine(),
      h(
        "button",
        { type: "button", className: "primary", onclick: requestMic },
        "Allow microphone",
      ),
    );
  },

  ready() {
    const start = h(
      "button",
      { type: "button", className: "primary", onclick: startCall },
      "Start call",
    );
    ui.start = start;
    return h(
      "section",
      {},
      h("h1", {}, "Ready"),
      h("p", {}, "Press Speak to talk and Done when you finish each turn."),
      h("p", {}, `Time limit: ${limitLabel()}.`),
      errorLine(),
      start,
    );
  },

  call() {
    ui.clock = h("span", { className: "clock" }, formatRemaining(state.limitMs));
    ui.lines = h("ol", { className: "prospect-lines", "aria-live": "polite" });
    ui.empty = h("p", { className: "hint" }, "Press Speak and say your opening line.");
    ui.status = h("p", { className: "status", role: "status" }, state.status);
    ui.speak = h("button", { type: "button", className: "primary", onclick: onSpeak }, "Speak");
    ui.done = h("button", { type: "button", className: "primary", onclick: onDone }, "Done");
    ui.end = h("button", { type: "button", className: "danger", onclick: onEndCall }, "End Call");
    for (const text of state.lines) addLine(text);
    queueMicrotask(updateControls);
    const label = cfg.maxCallMinutesIsDemo ? "Time left (demo limit)" : "Time left";
    return h(
      "section",
      { className: "call" },
      h("p", { className: "timer" }, `${label}: `, ui.clock),
      h("h2", {}, "Prospect"),
      ui.empty,
      ui.lines,
      ui.status,
      h("div", { className: "controls" }, ui.speak, ui.done, ui.end),
    );
  },

  uploading() {
    return h("section", {}, h("h1", {}, "Uploading"), h("p", {}, "Keep this page open."));
  },

  retry() {
    const children = [h("h1", {}, state.tooLarge ? "Recording too large" : "Upload failed")];
    if (state.tooLarge) {
      children.push(
        h(
          "p",
          {},
          "The recording is too large to upload. Download it and send it to the hiring team.",
        ),
        h(
          "button",
          { type: "button", className: "primary", onclick: downloadRecording },
          "Download recording",
        ),
      );
    } else {
      children.push(
        errorLine(),
        h("button", { type: "button", className: "primary", onclick: retryUpload }, "Retry upload"),
      );
    }
    return h("section", {}, ...children);
  },

  done() {
    const link = h("input", {
      type: "text",
      readOnly: true,
      value: state.link,
      "aria-label": "Recording link",
    });
    const copy = h(
      "button",
      { type: "button", className: "primary", onclick: () => copyLink(copy, link) },
      "Copy",
    );
    return h(
      "section",
      {},
      h("h1", {}, "Call complete"),
      h("p", {}, "Paste this link into your Paid Test document."),
      h("div", { className: "link-row" }, link, copy),
    );
  },
};

async function copyLink(button, input) {
  try {
    await navigator.clipboard.writeText(state.link);
    button.textContent = "Copied";
  } catch {
    input.select();
    button.textContent = "Select and copy";
  }
}

async function requestMic() {
  state.error = "";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    state.error = "This browser cannot record audio. Open the link in Chrome, Safari or Firefox.";
    render();
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    state.error = "Microphone access was blocked. Allow it in the browser and try again.";
    render();
    return;
  }
  state.mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
  go({ type: "granted" });
}

// Each recording is a complete file: no timeslice, one chunk at stop.
function record() {
  const options = { audioBitsPerSecond: AUDIO_BITS_PER_SECOND };
  if (state.mimeType) options.mimeType = state.mimeType;
  const recorder = new MediaRecorder(state.stream, options);
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const stopped = new Promise((resolve) => {
    const finish = () =>
      resolve(new Blob(chunks, { type: recorder.mimeType || state.mimeType || "" }));
    recorder.addEventListener("stop", finish, { once: true });
    recorder.addEventListener("error", finish, { once: true });
  });
  recorder.start();
  return {
    stop() {
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
  };
}

async function startCall() {
  ui.start.disabled = true;
  state.error = "";
  let response = null;
  try {
    response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: state.name.trim() }),
    });
  } catch {
    state.error = "Could not reach the server. Try again.";
  }
  if (response && !response.ok) {
    if (response.status === 403) state.error = "The access code in this link was not accepted.";
    else if (response.status === 422) state.error = "Your name must be 1 to 80 characters.";
    else state.error = "Could not start the call. Try again.";
  }
  const session = response?.ok ? await response.json().catch(() => null) : null;
  if (!session?.id) {
    state.error ||= "Could not start the call. Try again.";
    render();
    return;
  }
  state.id = session.id;
  state.limitMs = session.maxCallMinutes * 60000;
  state.full = record();
  state.startedAt = performance.now();
  state.timer = setInterval(tick, 250);
  go({ type: "start" });
}

function tick() {
  const left = state.limitMs - (performance.now() - state.startedAt);
  if (ui.clock) ui.clock.textContent = formatRemaining(left);
  if (left <= 0) beginFinish("limit_reached", 0);
}

function setStatus(text) {
  state.status = text;
  if (ui.status) ui.status.textContent = text;
}

function updateControls() {
  if (!ui.speak) return;
  const locked = state.finishing || state.busy !== null;
  ui.speak.disabled = locked || state.turn !== null || state.pending !== null;
  ui.done.disabled = locked || (state.turn === null && state.pending === null);
  ui.end.disabled = locked;
}

function addLine(text) {
  ui.empty.hidden = true;
  for (const old of ui.lines.querySelectorAll(".latest")) old.classList.remove("latest");
  ui.lines.append(h("li", { className: "latest" }, text));
  ui.lines.lastElementChild.scrollIntoView?.({ block: "nearest" });
}

function onSpeak() {
  if (state.finishing || state.busy || state.turn || state.pending) return;
  state.turn = record();
  setStatus("Listening. Press Done when you finish.");
  updateControls();
}

function onDone() {
  if (state.busy) return;
  state.busy = doDone().finally(() => {
    state.busy = null;
    updateControls();
  });
  updateControls();
}

async function doDone() {
  if (state.turn) {
    const clientMs = Math.round(performance.now() - state.startedAt);
    const recording = state.turn;
    const blob = await recording.stop();
    state.turn = null;
    state.pending = { index: state.turnIndex, clientMs, blob, resent: false };
  }
  if (state.pending && !state.finishing) await submitPending();
}

async function submitPending() {
  const turn = state.pending;
  setStatus("Sending.");
  const form = new FormData();
  const type = turn.blob.type;
  form.append("audio", turn.blob, `turn-${turn.index}.${recordingExtension(type)}`);
  form.append("mime", type);
  form.append("turnIndex", String(turn.index));
  form.append("clientMs", String(turn.clientMs));

  let status = 0;
  let body = null;
  try {
    const response = await postWithRetry(fetch, `/api/s/${state.id}/turn`, form);
    status = response.status;
    body = await response.json().catch(() => null);
  } catch {
    // A network failure after every retry is handled as status 0 below.
  }

  if (status === 200 && typeof body?.text === "string") {
    state.pending = null;
    state.turnIndex = turn.index + 1;
    state.lines.push(body.text);
    addLine(body.text);
    setStatus("");
    if (body.ended) beginFinish("candidate_ended", LAST_LINE_MS);
    return;
  }
  const next = onTurnError(status, body, turn.resent);
  if (next.action === "upload") {
    state.pending = null;
    setStatus("");
    beginFinish("candidate_ended", 0);
  } else if (next.action === "resend") {
    turn.resent = true;
    await submitPending();
  } else {
    setStatus(next.message);
  }
}

function onEndCall() {
  if (!window.confirm("End the call now?")) return;
  beginFinish("candidate_ended", 0);
}

// The first caller wins; later ones (timer, button, last line) are ignored.
async function beginFinish(reason, lingerMs) {
  if (state.finishing) return;
  state.finishing = true;
  state.reason = reason;
  clearInterval(state.timer);
  updateControls();
  if (state.busy) await state.busy;
  if (lingerMs > 0) await sleep(lingerMs);
  if (state.turn) {
    await state.turn.stop();
    state.turn = null;
  }
  state.blob = await state.full.stop();
  for (const track of state.stream.getTracks()) track.stop();
  if (go({ type: "end" })) await upload();
}

async function upload() {
  state.error = "";
  state.tooLarge = tooLargeToUpload(state.blob.size);
  if (state.tooLarge) {
    go({ type: "failed" });
    return;
  }
  const type = state.blob.type;
  const form = new FormData();
  form.append("audio", state.blob, `call.${recordingExtension(type)}`);
  form.append("mime", type);
  form.append("reason", state.reason);

  let response = null;
  try {
    response = await postWithRetry(fetch, `/api/s/${state.id}/end`, form);
  } catch {
    // Reported below as a failed upload.
  }
  const result = response?.ok ? await response.json().catch(() => null) : null;
  if (typeof result?.url === "string") {
    state.link = result.url;
    go({ type: "uploaded" });
    return;
  }
  state.tooLarge = response?.status === 413;
  state.error = "The upload did not go through. Check your connection and retry.";
  go({ type: "failed" });
}

function retryUpload() {
  if (go({ type: "retry" })) upload();
}

function downloadRecording() {
  const url = URL.createObjectURL(state.blob);
  const link = h("a", { href: url, download: `mock-call.${recordingExtension(state.blob.type)}` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Nothing is saved until End, so closing the tab mid-call loses the audio.
window.addEventListener("beforeunload", (event) => {
  if (["call", "uploading", "retry"].includes(state.screen)) event.preventDefault();
});

render();
