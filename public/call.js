import {
  callControls,
  callPhase,
  formatRemaining,
  HEARD_DB,
  meterFraction,
  micCheck,
  micConstraints,
  NAME_MAX,
  nextScreen,
  onTurnError,
  peakDb,
  pickMimeType,
  postWithRetry,
  recordingExtension,
  STEPS,
  stepFor,
  tooLargeToUpload,
  typedTurnBytes,
} from "./call-core.js";

const AUDIO_BITS_PER_SECOND = 32000;
const LAST_LINE_MS = 3000;
const QUIET_TURN = "We did not hear you in that turn. Check that your microphone is not muted.";
const LOST_PRACTICE = "Connection lost. Press Done to send that turn again, or Redo to start over.";
const LOST_TYPED = "Connection lost. Press Send to send that turn again, or Redo to start over.";
const cfg = JSON.parse(document.getElementById("cfg").textContent);
const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const code = params.get("code") ?? "";
// Typed practice turns are a test path: demo mode only, and only when the link asks for it.
// The demo transcriber echoes typed text; a real one would not understand it.
const textAllowed = cfg.mode === "demo" && params.get("text") === "1";

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
  // Practice calls live only in this page; the server sends the state back each turn.
  practiceState: null,
  practiceNote: "",
  confirmTicked: false,
  // Bumped by Redo and by the end of a practice call, so late answers to an old call are dropped.
  callGen: 0,
  // Sound check: the level meter runs from the moment the microphone is granted.
  audioCtx: null,
  analyser: null,
  meterTimer: null,
  micPhase: "ask",
  micLabel: "",
  micId: "",
  devices: [],
  heard: false,
  checkStart: 0,
  turnPeak: Number.NEGATIVE_INFINITY,
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
  app.replaceChildren(stepBar(), views[state.screen]());
}

// The five steps are a real sequence, so they are numbered. Practice and final call get their
// own colours here too, matching the call screens.
function stepBar() {
  const { index, finished } = stepFor(state.screen);
  const items = STEPS.map((label, i) => {
    let stage = "todo";
    if (i < index || finished) stage = "done";
    else if (i === index) stage = "current";
    const item = h("li", { className: `step step-${stage}` }, label);
    if (stage === "current") item.setAttribute("aria-current", "step");
    return item;
  });
  const now = finished ? "All steps done" : `Step ${index + 1} of ${STEPS.length}: ${STEPS[index]}`;
  return h(
    "nav",
    { className: `steps steps-at-${index}`, "aria-label": "Progress" },
    h("p", { className: "steps-now" }, now),
    h("ol", {}, ...items),
  );
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
    return h(
      "section",
      {},
      h("h1", {}, "Mock call"),
      h(
        "p",
        { className: "lead" },
        "You will practise a sales call with a scripted prospect, then make one recorded final call.",
      ),
      form,
    );
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
        h("label", { htmlFor: "notice-tick" }, "I understand my final call is recorded"),
      ),
      next,
    );
  },

  mic() {
    if (state.micPhase === "check") return micCheckView();
    return h(
      "section",
      {},
      h("h1", {}, "Microphone"),
      h("p", {}, "Allow the microphone so the call can be recorded."),
      h(
        "p",
        { className: "hint" },
        "Your browser asks for permission after you press the button. Choose Allow.",
      ),
      errorLine(),
      h(
        "div",
        { className: "actions" },
        h(
          "button",
          { type: "button", className: "primary", onclick: () => requestMic() },
          "Allow microphone",
        ),
        ...(textAllowed
          ? [
              h(
                "button",
                {
                  type: "button",
                  onclick() {
                    state.error = "";
                    go({ type: "skip", textAllowed });
                  },
                },
                "Continue without a microphone (typed test)",
              ),
            ]
          : []),
      ),
    );
  },

  ready() {
    const hasMic = state.stream !== null;
    const practice = h(
      "button",
      { type: "button", className: "practice", onclick: startPractice },
      "Start practice call",
    );
    ui.start = practice;
    const children = [
      h("h1", {}, "Practice, then make your final call"),
      h(
        "p",
        {},
        hasMic
          ? "Press Speak to talk and Done when you finish each turn."
          : "Typed test: type each turn and press Send. Nothing is recorded.",
      ),
      h("p", {}, `Time limit: ${limitLabel()}.`),
    ];
    if (state.practiceNote) {
      children.push(h("p", { className: "note", role: "status" }, state.practiceNote));
    }
    const finalCard = hasMic
      ? [
          h("p", {}, "Recorded and graded. One attempt, with no redo."),
          h(
            "button",
            {
              type: "button",
              className: "final",
              onclick: () => go({ type: "final", hasMic }),
            },
            "Make my final call",
          ),
        ]
      : [
          h("p", {}, "Recorded and graded. The final call needs a microphone."),
          h("button", { type: "button", onclick: () => go({ type: "mic" }) }, "Allow microphone"),
        ];
    children.push(
      errorLine(),
      h(
        "div",
        { className: "choices" },
        h(
          "div",
          { className: "choice practice-choice" },
          h("h2", {}, h("span", { className: "dot", "aria-hidden": "true" }), "Practice call"),
          h(
            "p",
            {},
            "Practice as many times as you like. Practice calls are not recorded, not saved and not graded.",
          ),
          practice,
        ),
        h(
          "div",
          { className: "choice final-choice" },
          h("h2", {}, h("span", { className: "dot", "aria-hidden": "true" }), "Final call"),
          ...finalCard,
        ),
      ),
    );
    return h("section", {}, ...children);
  },

  confirm() {
    const start = h(
      "button",
      { type: "button", className: "final", disabled: !state.confirmTicked, onclick: startCall },
      "Start final call",
    );
    ui.start = start;
    const tick = h("input", {
      id: "final-tick",
      type: "checkbox",
      checked: state.confirmTicked,
      onchange(event) {
        state.confirmTicked = event.target.checked;
        start.disabled = !state.confirmTicked;
      },
    });
    const back = h(
      "button",
      {
        type: "button",
        onclick() {
          state.confirmTicked = false;
          go({ type: "back" });
        },
      },
      "Back to practice",
    );
    return h(
      "section",
      {},
      h("h1", {}, "Start your final call?"),
      h(
        "ul",
        {},
        h("li", {}, "This call is recorded and graded."),
        h("li", {}, "You get one attempt. There is no redo."),
        h("li", {}, "When it ends you get the link for your Paid Test document."),
      ),
      h(
        "div",
        { className: "tick" },
        tick,
        h("label", { htmlFor: "final-tick" }, "I am ready to make my final call"),
      ),
      errorLine(),
      h("div", { className: "actions" }, start, back),
    );
  },

  practice() {
    return callView("practice");
  },

  call() {
    return callView("call");
  },

  uploading() {
    return h(
      "section",
      { className: "state state-busy" },
      h("div", { className: "progress", role: "progressbar", "aria-label": "Uploading" }),
      h("h1", {}, "Uploading"),
      h("p", {}, "Keep this page open."),
    );
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
      h("div", { className: "tick-mark", "aria-hidden": "true" }),
      h("h1", {}, "Call complete"),
      h("p", {}, "Paste this link into your Paid Test document."),
      h("div", { className: "link-row" }, link, copy),
    );
  },
};

// The practice and final call screens share one layout, built like a phone call: who is on the
// line and whether it is recorded at the top, the prospect's latest line in the middle, and one
// main button at the bottom.
function callView(screen) {
  const practice = screen === "practice";
  const typed = practice && state.stream === null;
  ui.clock = h("span", { className: "clock" }, formatRemaining(state.limitMs));
  ui.lines = h("ol", { className: "prospect-lines", "aria-live": "polite" });
  ui.empty = h(
    "p",
    { className: "opening" },
    typed ? "Type your opening line and press Send." : "Press Speak and say your opening line.",
  );
  ui.status = h("p", { className: "status", role: "status" }, state.status);
  ui.speak = h("button", { type: "button", className: "speak-btn", onclick: onSpeak }, "Speak");
  ui.done = h("button", { type: "button", className: "done-btn", onclick: onDone }, "Done");
  ui.redo = h("button", { type: "button", className: "quiet", onclick: onRedo }, "Redo");
  ui.end = h(
    "button",
    { type: "button", className: "quiet danger", onclick: onEndCall },
    practice ? "End practice" : "End Call",
  );
  ui.say = h("input", {
    type: "text",
    id: "typed-turn",
    autocomplete: "off",
    "aria-label": "Your line",
    placeholder: "Type what you would say",
  });
  ui.send = h("button", { type: "submit", className: "primary" }, "Send");
  for (const text of state.lines) addLine(text);
  queueMicrotask(updateControls);

  const names = callControls(screen, typed);
  const side = names.filter((name) => name === "redo" || name === "end").map((name) => ui[name]);
  const main = typed
    ? h(
        "form",
        {
          className: "typed-row",
          onsubmit(event) {
            event.preventDefault();
            onSend();
          },
        },
        ui.say,
        ui.send,
      )
    : h("div", { className: "talk-row" }, ui.speak, ui.done);

  const top = h(
    "header",
    { className: "call-top", role: "status" },
    h(
      "div",
      { className: "call-state" },
      h("span", { className: practice ? "dot" : "dot rec-dot", "aria-hidden": "true" }),
      h("strong", {}, practice ? "Practice call" : "Final call"),
      h(
        "span",
        { className: "call-sub" },
        practice ? "Not recorded, not saved, does not count." : "Recording. Graded. One attempt.",
      ),
    ),
    h(
      "div",
      { className: "call-time" },
      ui.clock,
      h("span", {}, cfg.maxCallMinutesIsDemo ? "Time left (demo limit)" : "Time left"),
    ),
  );
  const children = [
    top,
    h("div", { className: "prospect" }, h("h2", {}, "Prospect"), ui.empty, ui.lines),
    h(
      "div",
      { className: "controls" },
      ...(typed
        ? []
        : [h("div", { className: "meter call-meter", "aria-hidden": "true" }, meterFill())]),
      ui.status,
      main,
      h("div", { className: "side-row" }, ...side),
    ),
  ];
  if (practice && !typed) {
    children.push(
      h(
        "p",
        { className: "footnote" },
        "Your speech is still sent to the speech-to-text and AI services so the prospect can answer.",
      ),
    );
  }
  ui.section = h(
    "section",
    { className: `call ${practice ? "call-practice" : "call-final"}` },
    ...children,
  );
  return ui.section;
}

async function copyLink(button, input) {
  try {
    await navigator.clipboard.writeText(state.link);
    button.textContent = "Copied";
  } catch {
    input.select();
    button.textContent = "Select and copy";
  }
}

const MIC_STATUS = {
  listening: "Listening for your voice.",
  heard: "We can hear you.",
  silent:
    "No sound from this microphone yet. Check that it is not muted and its input volume is up.",
  silentPick:
    "No sound from this microphone yet. Check that it is not muted, or choose another microphone below.",
};

// The sound check: the candidate sees the level move before any call can start, so a muted or
// wrong microphone is caught here and not in a silent graded recording.
function micCheckView() {
  ui.meterFill = h("div", { className: "meter-fill" });
  ui.micStatus = h("p", { className: "mic-status", role: "status" }, MIC_STATUS.listening);
  ui.micContinue = h(
    "button",
    {
      type: "button",
      className: "primary",
      disabled: !state.heard,
      onclick: () => go({ type: "granted", heard: state.heard }),
    },
    "Continue",
  );
  const picker = h("select", {
    id: "mic-pick",
    onchange: (event) => requestMic(event.target.value),
  });
  for (const device of state.devices) {
    const option = h("option", { value: device.deviceId }, device.label || "Microphone");
    option.selected = device.deviceId === state.micId;
    picker.append(option);
  }
  return h(
    "section",
    {},
    h("h1", {}, "Microphone"),
    h("p", {}, "Say a few words out loud. The bar moves when the microphone hears you."),
    h("div", { className: "meter", "aria-hidden": "true" }, ui.meterFill),
    ui.micStatus,
    h(
      "div",
      { className: "field" },
      h("label", { htmlFor: "mic-pick" }, "Microphone in use"),
      state.devices.length > 0 ? picker : h("p", { className: "hint" }, state.micLabel),
    ),
    errorLine(),
    h("div", { className: "actions" }, ui.micContinue),
  );
}

// Runs for as long as the microphone is open. It moves whichever meter is on screen, settles
// the sound check, and keeps the loudest level of the turn being recorded.
function readMeter() {
  const samples = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(samples);
  const db = peakDb(samples);
  if (state.turn && db > state.turnPeak) state.turnPeak = db;
  if (ui.meterFill) ui.meterFill.style.width = `${Math.round(meterFraction(db) * 100)}%`;
  if (state.screen !== "mic" || state.micPhase !== "check") return;
  if (db >= HEARD_DB) state.heard = true;
  const result = micCheck(state.heard, performance.now() - state.checkStart);
  if (ui.micStatus) {
    const pick = result === "silent" && state.devices.length > 1;
    ui.micStatus.textContent = MIC_STATUS[pick ? "silentPick" : result];
    ui.micStatus.dataset.result = result;
  }
  if (ui.micContinue) ui.micContinue.disabled = !state.heard;
}

function stopMic() {
  clearInterval(state.meterTimer);
  state.meterTimer = null;
  if (state.stream) for (const track of state.stream.getTracks()) track.stop();
}

async function requestMic(deviceId) {
  const constraints = micConstraints(deviceId);
  const chosen = constraints.audio !== true;
  state.error = "";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    state.error = "This browser cannot record audio. Open the link in Chrome, Safari or Firefox.";
    render();
    return;
  }
  // Made inside the click, before any wait, so the browser lets it run.
  const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
  if (!state.audioCtx && AudioCtx) state.audioCtx = new AudioCtx();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    state.error = chosen
      ? "That microphone could not be opened. Choose another one."
      : "Microphone access was blocked. Allow it in the browser and try again.";
    render();
    return;
  }
  stopMic();
  state.stream = stream;
  state.mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
  const track = stream.getAudioTracks()[0];
  state.micLabel = track?.label || "Microphone";
  state.micId = track?.getSettings?.().deviceId ?? "";
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    state.devices = all.filter((device) => device.kind === "audioinput" && device.deviceId);
  } catch {
    state.devices = [];
  }
  state.heard = false;
  state.checkStart = performance.now();
  state.micPhase = "check";
  if (!state.audioCtx) {
    // No way to measure sound in this browser: do not lock the candidate out.
    state.heard = true;
  } else {
    await state.audioCtx.resume().catch(() => {});
    state.analyser = state.audioCtx.createAnalyser();
    state.audioCtx.createMediaStreamSource(stream).connect(state.analyser);
    state.meterTimer = setInterval(readMeter, 100);
  }
  render();
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
  resetCall();
  state.full = record();
  state.startedAt = performance.now();
  state.timer = setInterval(tick, 250);
  go({ type: "start", confirmed: state.confirmTicked });
}

// Fresh per-call page state, shared by the final call, a practice call and Redo.
function resetCall() {
  state.callGen++;
  clearInterval(state.timer);
  state.turn?.stop();
  state.turn = null;
  state.pending = null;
  state.busy = null;
  state.finishing = false;
  state.turnIndex = 0;
  state.lines = [];
  state.status = "";
}

async function startPractice() {
  if (ui.start) ui.start.disabled = true;
  state.error = "";
  let body = null;
  try {
    const response = await fetch("/api/practice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (response.status === 403) state.error = "The access code in this link was not accepted.";
    body = response.ok ? await response.json().catch(() => null) : null;
  } catch {
    state.error = "Could not reach the server. Try again.";
  }
  if (!body?.state) {
    state.error ||= "Could not start the practice call. Try again.";
    render();
    return;
  }
  resetCall();
  state.practiceState = body.state;
  state.practiceNote = "";
  state.limitMs = body.maxCallMinutes * 60000;
  state.startedAt = performance.now();
  state.timer = setInterval(tick, 250);
  // Redo starts a practice call while already on the practice screen, so render directly.
  if (!go({ type: "practice" })) render();
}

const REASON_WORDS = {
  booked: "the prospect booked the meeting",
  prospect_ended: "the prospect ended the call",
  limit_reached: "the time ran out",
  candidate_ended: "you ended it",
};

// Ends a practice call: nothing to upload, the microphone stays open for the next call.
async function finishPractice(reason, lingerMs) {
  if (state.finishing) return;
  state.finishing = true;
  const gen = state.callGen;
  clearInterval(state.timer);
  updateControls();
  if (lingerMs > 0) await sleep(lingerMs);
  if (gen !== state.callGen) return;
  resetCall();
  state.practiceState = null;
  state.practiceNote = `Practice call over: ${REASON_WORDS[reason] ?? "it ended"}. Practice again or make your final call.`;
  go({ type: "end" });
}

function tick() {
  const left = state.limitMs - (performance.now() - state.startedAt);
  if (ui.clock) ui.clock.textContent = formatRemaining(left);
  if (left > 0) return;
  if (state.screen === "practice") finishPractice("limit_reached", 0);
  else beginFinish("limit_reached", 0);
}

function setStatus(text) {
  state.status = text;
  if (ui.status) ui.status.textContent = text;
}

function updateControls() {
  if (!ui.speak) return;
  const locked = state.finishing || state.busy !== null;
  // The phase picks the one main button the stylesheet shows: Speak, or Done.
  ui.section.dataset.phase = callPhase({
    finishing: state.finishing,
    busy: state.busy !== null,
    listening: state.turn !== null,
    pending: state.pending !== null,
  });
  ui.say.disabled = locked;
  ui.send.disabled = locked;
  ui.speak.disabled = locked || state.turn !== null || state.pending !== null;
  ui.done.disabled = locked || (state.turn === null && state.pending === null);
  ui.end.disabled = locked;
  ui.redo.disabled = state.finishing;
}

function meterFill() {
  ui.meterFill = h("div", { className: "meter-fill" });
  return ui.meterFill;
}

function addLine(text) {
  ui.empty.hidden = true;
  for (const old of ui.lines.querySelectorAll(".latest")) old.classList.remove("latest");
  ui.lines.append(h("li", { className: "latest" }, text));
  ui.lines.lastElementChild.scrollIntoView?.({ block: "nearest" });
}

function onSpeak() {
  if (state.finishing || state.busy || state.turn || state.pending) return;
  state.turnPeak = Number.NEGATIVE_INFINITY;
  state.turn = record();
  setStatus("Listening. Press Done when you finish.");
  updateControls();
}

// The typed test path: the line travels in the turn's audio field, which the demo transcriber
// echoes back. A turn that failed to send is kept and sent again.
function onSend() {
  if (state.finishing || state.busy || state.screen !== "practice") return;
  if (!state.pending) {
    const bytes = typedTurnBytes(ui.say.value);
    if (!bytes) {
      setStatus(
        ui.say.value.trim() === "" ? "Type a line first." : "That line is too long. Shorten it.",
      );
      return;
    }
    const clientMs = Math.round(performance.now() - state.startedAt);
    const blob = new Blob([bytes], { type: "text/plain" });
    state.pending = { index: state.turnIndex, clientMs, blob, resent: false };
    ui.say.value = "";
  }
  onDone();
}

function onDone() {
  if (state.busy) return;
  const gen = state.callGen;
  state.busy = doDone().finally(() => {
    if (gen !== state.callGen) return;
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
    const quiet = state.analyser !== null && state.turnPeak < HEARD_DB;
    state.pending = { index: state.turnIndex, clientMs, blob, resent: false, quiet };
  }
  if (state.pending && !state.finishing) {
    await (state.screen === "practice" ? submitPractice() : submitPending());
  }
}

async function submitPractice() {
  const turn = state.pending;
  const gen = state.callGen;
  setStatus("Sending.");
  const form = new FormData();
  const type = turn.blob.type;
  form.append("audio", turn.blob, `turn-${turn.index}.${recordingExtension(type)}`);
  form.append("mime", type);
  form.append("clientMs", String(turn.clientMs));
  form.append("code", code);
  form.append("state", JSON.stringify(state.practiceState));

  let body = null;
  try {
    const response = await postWithRetry(fetch, "/api/practice/turn", form);
    body = response.ok ? await response.json().catch(() => null) : null;
  } catch {
    // Reported below.
  }
  if (gen !== state.callGen) return;
  if (typeof body?.text !== "string" || !body.state) {
    setStatus(state.stream === null ? LOST_TYPED : LOST_PRACTICE);
    return;
  }
  state.pending = null;
  state.practiceState = body.state;
  state.turnIndex = turn.index + 1;
  if (body.text !== "") {
    state.lines.push(body.text);
    addLine(body.text);
  }
  setStatus(turn.quiet ? QUIET_TURN : "");
  if (body.ended) finishPractice(body.endReason, body.text === "" ? 0 : LAST_LINE_MS);
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
    setStatus(turn.quiet ? QUIET_TURN : "");
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
  if (state.screen === "practice") {
    finishPractice("candidate_ended", 0);
    return;
  }
  if (!window.confirm("End the call now?")) return;
  beginFinish("candidate_ended", 0);
}

// Only the practice screen has a Redo button (callControls); the final call is one attempt.
function onRedo() {
  if (state.screen !== "practice" || state.finishing) return;
  startPractice();
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
  stopMic();
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
