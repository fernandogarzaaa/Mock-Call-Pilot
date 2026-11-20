import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { CallTurn, Transcript } from "../src/types/index.ts";
import { checkSession, percentile } from "./load-check.ts";

const MAX_TURNS = 4;
const END_AUDIO_BYTES = 1024;

export interface LoadTestOptions {
  url: string;
  sessions: number;
  code: string;
  /** Real vendors: session n speaks the clip `<clipsDir>/<n>.wav`, whose word is line n of markers.txt. */
  real?: { clipsDir: string };
}

export interface LoadTestResult {
  /** 1 when any session reported a problem, else 0. */
  exitCode: 0 | 1;
  /** Milliseconds from sending a turn to reading its response, over every session. */
  turnMs: number[];
  fallbackCauses: Record<string, number>;
  /** Problems per session number (1-based); sessions without problems are absent. */
  problems: Record<number, string[]>;
}

export class UsageError extends Error {}

type Log = (line: string) => void;

interface SessionOutcome {
  turnMs: number[];
  turns: CallTurn[];
  problems: string[];
}

async function readMarkers(clipsDir: string, sessions: number): Promise<string[]> {
  const text = await readFile(join(clipsDir, "markers.txt"), "utf8");
  const markers = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (markers.length < sessions) {
    throw new UsageError(`markers.txt lists ${markers.length} words but ${sessions} are needed`);
  }
  return markers.slice(0, sessions);
}

function failure(label: string, status: number): string {
  return `${label} returned HTTP ${status}`;
}

async function runSession(
  options: LoadTestOptions,
  number: number,
  marker: string,
  others: readonly string[],
): Promise<SessionOutcome> {
  const base = options.url.replace(/\/+$/, "");
  const outcome: SessionOutcome = { turnMs: [], turns: [], problems: [] };
  const started = Date.now();

  const created = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: options.code, name: `load-test-${number}` }),
  });
  if (created.status !== 201) {
    outcome.problems.push(failure("create session", created.status));
    return outcome;
  }
  const { id } = (await created.json()) as { id: string };

  const turnAudio = options.real
    ? new Uint8Array(await readFile(join(options.real.clipsDir, `${number}.wav`)))
    : new TextEncoder().encode(marker);
  const turnMime = options.real ? "audio/wav" : "audio/webm";

  for (let index = 0; index < MAX_TURNS; index++) {
    const form = new FormData();
    form.append("audio", new Blob([turnAudio], { type: turnMime }), "turn");
    form.append("mime", turnMime);
    form.append("turnIndex", String(index));
    form.append("clientMs", String(Date.now() - started));

    const sentAt = performance.now();
    const res = await fetch(`${base}/api/s/${id}/turn`, { method: "POST", body: form });
    const body = res.ok ? ((await res.json()) as { ended?: boolean }) : null;
    outcome.turnMs.push(performance.now() - sentAt);
    if (body === null) {
      outcome.problems.push(failure(`turn ${index}`, res.status));
      break;
    }
    if (body.ended) break;
  }

  const end = new FormData();
  end.append("audio", new Blob([new Uint8Array(END_AUDIO_BYTES)], { type: "audio/webm" }), "call");
  end.append("mime", "audio/webm");
  end.append("reason", "candidate_ended");
  const ended = await fetch(`${base}/api/s/${id}/end`, { method: "POST", body: end });
  if (!ended.ok) {
    outcome.problems.push(failure("end", ended.status));
    return outcome;
  }

  const stored = await fetch(`${base}/r/${id}/transcript.json`);
  if (!stored.ok) {
    outcome.problems.push(failure("transcript", stored.status));
    return outcome;
  }
  const transcript = (await stored.json()) as Transcript;
  outcome.turns = transcript.turns;
  outcome.problems.push(...checkSession(marker, others, transcript));
  return outcome;
}

export async function runLoadTest(
  options: LoadTestOptions,
  log: Log = console.log,
): Promise<LoadTestResult> {
  const numbers = Array.from({ length: options.sessions }, (_, i) => i + 1);
  const markers = options.real
    ? await readMarkers(options.real.clipsDir, options.sessions)
    : numbers.map((n) => `marker-${n}`);

  const outcomes = await Promise.all(
    numbers.map(async (n): Promise<SessionOutcome> => {
      const marker = markers[n - 1] as string;
      const others = markers.filter((_, i) => i !== n - 1);
      try {
        return await runSession(options, n, marker, others);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { turnMs: [], turns: [], problems: [`session failed: ${reason}`] };
      }
    }),
  );

  const turnMs = outcomes.flatMap((o) => o.turnMs);
  const fallbackCauses: Record<string, number> = {};
  for (const turn of outcomes.flatMap((o) => o.turns)) {
    if (turn.fallbackCause !== undefined) {
      fallbackCauses[turn.fallbackCause] = (fallbackCauses[turn.fallbackCause] ?? 0) + 1;
    }
  }
  const problems: Record<number, string[]> = {};
  outcomes.forEach((outcome, i) => {
    if (outcome.problems.length > 0) problems[i + 1] = outcome.problems;
  });

  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  log(`sessions: ${options.sessions}, turns timed: ${turnMs.length}`);
  if (turnMs.length > 0) {
    log(`turn time median: ${seconds(percentile(turnMs, 50))}`);
    log(`turn time 95th percentile: ${seconds(percentile(turnMs, 95))}`);
  } else {
    log("turn time: no turns completed");
  }
  const causes = Object.entries(fallbackCauses).map(([cause, count]) => `${cause}=${count}`);
  log(`fallback causes: ${causes.length > 0 ? causes.join(", ") : "none"}`);
  for (const [n, list] of Object.entries(problems)) {
    for (const problem of list) log(`session ${n}: ${problem}`);
  }
  log(Object.keys(problems).length > 0 ? "FAIL" : "PASS");

  return { exitCode: Object.keys(problems).length > 0 ? 1 : 0, turnMs, fallbackCauses, problems };
}

export const USAGE = "usage: load-test.ts URL S --code CODE [--real --clips DIR]";

const PARSE_OPTIONS = {
  code: { type: "string" },
  real: { type: "boolean" },
  clips: { type: "string" },
} as const;

function parseFlags(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], allowPositionals: true, options: PARSE_OPTIONS });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

export function parseLoadTestArgs(argv: readonly string[]): LoadTestOptions {
  const parsed = parseFlags(argv);
  const [url, count, ...extra] = parsed.positionals;
  const { code, real, clips } = parsed.values;
  if (url === undefined || count === undefined || extra.length > 0) throw new UsageError(USAGE);
  if (!/^https?:\/\//.test(url) || !URL.canParse(url)) {
    throw new UsageError(`URL must start with http:// or https://: ${url}`);
  }
  if (!/^[1-9]\d*$/.test(count)) throw new UsageError(`S must be a positive integer: ${count}`);
  if (code === undefined || code === "") throw new UsageError("--code is required");
  if (real && clips === undefined) throw new UsageError("--real needs --clips DIR");
  if (!real && clips !== undefined) throw new UsageError("--clips only applies with --real");

  const options: LoadTestOptions = { url, sessions: Number(count), code };
  if (real && clips !== undefined) options.real = { clipsDir: clips };
  return options;
}

if (import.meta.main) {
  try {
    const result = await runLoadTest(parseLoadTestArgs(process.argv.slice(2)));
    process.exit(result.exitCode);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(reason);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
