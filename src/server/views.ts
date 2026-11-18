import { html, raw } from "hono/html";
import type { CallTurn, SessionState } from "../types/index.ts";

export const DEMO_BANNER = "DEMO: placeholder content, not client-approved";

/** The only values the call page receives. It never carries a caller reply. */
export interface CallPageConfig {
  mode: "live" | "demo";
  clientDetails: string;
  taskInstructions: string;
  noticeText: string;
  maxCallMinutes: number;
  maxCallMinutesIsDemo: boolean;
}

function banner(demo: boolean) {
  if (!demo) return "";
  return html`<div class="demo-banner" role="status">${DEMO_BANNER}</div>`;
}

function page(title: string, demo: boolean, body: unknown) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/static/call.css">
</head>
<body>
${banner(demo)}
${body}
</body>
</html>`;
}

export async function callShell(cfg: CallPageConfig): Promise<string> {
  // html`` would escape the JSON and break it, so it goes in raw with "<" neutralised.
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const body = html`<main id="app"></main>
<script type="application/json" id="cfg">${raw(json)}</script>
<script type="module" src="/static/call.js"></script>`;
  return String(await page("Mock call", cfg.mode === "demo", body));
}

export async function messagePage(title: string, text: string, demo: boolean): Promise<string> {
  const body = html`<main><h1>${title}</h1><p>${text}</p></main>`;
  return String(await page(title, demo, body));
}

function causeAttr(cause: string | undefined) {
  if (cause === undefined) return "";
  return html` data-cause="${cause}"`;
}

function replyBox(reply: string | undefined) {
  if (reply === undefined) return "";
  return html`<div class="approved-reply">
<strong>Approved reply (for reviewer)</strong>
<p>${reply}</p>
</div>`;
}

function turnView(turn: CallTurn) {
  let candidate = turn.candidateText;
  if (candidate === "") candidate = `[not understood: ${turn.fallbackCause ?? "empty"}]`;
  return html`<li class="turn" data-index="${String(turn.index)}"${causeAttr(turn.fallbackCause)}>
<p class="candidate"><strong>Candidate:</strong> ${candidate}</p>
<p class="prospect"><strong>Prospect:</strong> ${turn.prospect.text}</p>
${replyBox(turn.prospect.callerReply)}
</li>`;
}

export async function recordingPage(state: SessionState, demo: boolean): Promise<string> {
  const turns = state.turns.map(turnView);
  // Resets src once so a page left open past the signed URL's lifetime can still play.
  const body = html`<main class="recording">
<h1>Mock call recording</h1>
<dl>
<dt>Candidate</dt><dd>${state.name}</dd>
<dt>Started</dt><dd>${state.startedAt}</dd>
<dt>End reason</dt><dd>${state.endReason ?? ""}</dd>
</dl>
<audio controls src="/r/${state.id}/audio"></audio>
<ol class="turns">${turns}</ol>
<script>
const audio = document.querySelector("audio");
audio.addEventListener("error", () => {
  if (audio.dataset.retried) return;
  audio.dataset.retried = "1";
  audio.src = audio.getAttribute("src").split("?")[0] + "?t=" + Date.now();
});
</script>
</main>`;
  return String(await page("Mock call recording", demo, body));
}
