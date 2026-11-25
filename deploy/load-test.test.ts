import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { FakePicker } from "../src/picker/fake.ts";
import { fixtureScript } from "../src/script/fixture.ts";
import { buildApp } from "../src/server/app.ts";
import { FsStorage } from "../src/storage/fs.ts";
import { FakeTranscriber } from "../src/stt/fake.ts";
import { FakeSynthesizer } from "../src/tts/fake.ts";
import type {
  LinePicker,
  ResolvedConfig,
  ScriptConfig,
  Synthesizer,
  Transcriber,
} from "../src/types/index.ts";
import { PickerError } from "../src/types/index.ts";
import { parseLoadTestArgs, runLoadTest, UsageError } from "./load-test.ts";

const run = promisify(execFile);
const CODE = "open-sesame";
const dirs: string[] = [];
const servers: { close: () => void }[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mock-call-load-"));
  dirs.push(dir);
  return dir;
}

interface Fakes {
  script?: ScriptConfig;
  picker?: LinePicker;
  transcriber?: Transcriber;
  synthesizer?: Synthesizer;
}

/** buildApp on a random local port, with fake vendors and a temporary filesystem bucket. */
async function startApp(fakes: Fakes = {}): Promise<string> {
  const script = fakes.script ?? fixtureScript;
  const config: ResolvedConfig = {
    mode: "demo",
    script,
    maxCallMinutes: 30,
    maxCallMinutesIsDemo: false,
    noticeText: "NOTICE",
    clientDetails: "CLIENT",
    taskInstructions: "TASK",
    accessCode: CODE,
  };
  const app = buildApp({
    config,
    storage: new FsStorage(await tempDir(), "test-secret"),
    transcriber: fakes.transcriber ?? new FakeTranscriber(),
    synthesizer: fakes.synthesizer ?? new FakeSynthesizer(),
    picker: fakes.picker ?? new FakePicker(script),
  });
  return await new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      resolve(`http://127.0.0.1:${info.port}`);
    });
    servers.push(server);
  });
}

function collect(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

describe("runLoadTest against buildApp with fakes", () => {
  it("runs 3 sessions of 4 turns and passes", async () => {
    const url = await startApp();
    const out = collect();
    const result = await runLoadTest({ url, sessions: 3, code: CODE }, out.log);

    expect(result.exitCode).toBe(0);
    expect(result.problems).toEqual({});
    expect(result.turnMs).toHaveLength(12);
    expect(result.fallbackCauses).toEqual({});
    const text = out.lines.join("\n");
    expect(text).toMatch(/median: \d+\.\d\d s/);
    expect(text).toMatch(/95th percentile: \d+\.\d\d s/);
    expect(text).toContain("fallback causes: none");
    expect(out.lines.at(-1)).toBe("PASS");
  });

  it("tolerates a trailing slash on the URL", async () => {
    const url = await startApp();
    const result = await runLoadTest({ url: `${url}/`, sessions: 1, code: CODE }, () => {});
    expect(result.exitCode).toBe(0);
  });

  it("stops a session early when a turn ends the call", async () => {
    const script: ScriptConfig = {
      ...fixtureScript,
      lines: fixtureScript.lines.map((line) =>
        line.id === "d1.okay" ? { ...line, endsCall: "prospect_ended" as const } : line,
      ),
    };
    const picker: LinePicker = { pick: async () => ({ lineId: "d1.okay" }) };
    const url = await startApp({ script, picker });
    const result = await runLoadTest({ url, sessions: 3, code: CODE }, () => {});

    expect(result.turnMs).toHaveLength(3);
    expect(result.exitCode).toBe(0);
  });

  it("fails and counts causes when the picker falls back on a vendor error", async () => {
    const picker: LinePicker = {
      pick: async () => {
        throw new PickerError("picker_error");
      },
    };
    const url = await startApp({ picker });
    const out = collect();
    const result = await runLoadTest({ url, sessions: 2, code: CODE }, out.log);

    expect(result.exitCode).toBe(1);
    expect(result.fallbackCauses).toEqual({ picker_error: 8 });
    expect(Object.keys(result.problems)).toEqual(["1", "2"]);
    expect(out.lines.join("\n")).toContain("fallback causes: picker_error=8");
    expect(out.lines.at(-1)).toBe("FAIL");
  });

  it("fails when sessions hear each other's words", async () => {
    const transcriber: Transcriber = { transcribe: async () => "marker-1" };
    const url = await startApp({ transcriber });
    const result = await runLoadTest({ url, sessions: 3, code: CODE }, () => {});

    expect(result.exitCode).toBe(1);
    expect(result.problems[1]).toBeUndefined();
    expect(result.problems[2]?.join("\n")).toContain("another session's marker");
    expect(result.problems[2]?.join("\n")).toContain("own marker");
  });

  it("fails with the HTTP status when the access code is wrong", async () => {
    const url = await startApp();
    const result = await runLoadTest({ url, sessions: 2, code: "wrong" }, () => {});

    expect(result.exitCode).toBe(1);
    expect(result.turnMs).toEqual([]);
    expect(result.problems[1]).toEqual(["create session returned HTTP 403"]);
  });

  it("reports a server that cannot be reached as a failed session, not a crash", async () => {
    const result = await runLoadTest(
      { url: "http://127.0.0.1:1", sessions: 1, code: CODE },
      () => {},
    );
    expect(result.exitCode).toBe(1);
    expect(result.problems[1]?.[0]).toContain("session failed");
  });
});

describe("runLoadTest with --real clips", () => {
  async function clipsDir(markers: string[], spoken: string[] = markers): Promise<string> {
    const dir = await tempDir();
    await writeFile(join(dir, "markers.txt"), `${markers.join("\n")}\n`);
    // FakeTranscriber reads short UTF-8 audio as its own text, so a "clip" is just the word.
    await Promise.all(spoken.map((word, i) => writeFile(join(dir, `${i + 1}.wav`), word)));
    return dir;
  }

  it("sends each session's clip and matches it to its line in markers.txt", async () => {
    const url = await startApp();
    const dir = await clipsDir(["alpha", "bravo", "charlie"]);
    const result = await runLoadTest(
      { url, sessions: 3, code: CODE, real: { clipsDir: dir } },
      () => {},
    );
    expect(result.exitCode).toBe(0);
  });

  it("fails a session whose clip says a different word than markers.txt", async () => {
    const url = await startApp();
    const dir = await clipsDir(["alpha", "bravo"], ["alpha", "delta"]);
    const result = await runLoadTest(
      { url, sessions: 2, code: CODE, real: { clipsDir: dir } },
      () => {},
    );
    expect(result.exitCode).toBe(1);
    expect(result.problems[1]).toBeUndefined();
    expect(result.problems[2]?.join("\n")).toContain("own marker");
  });

  it("rejects a markers.txt that lists fewer words than sessions", async () => {
    const url = await startApp();
    const dir = await clipsDir(["alpha"]);
    await expect(
      runLoadTest({ url, sessions: 2, code: CODE, real: { clipsDir: dir } }, () => {}),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

describe("parseLoadTestArgs", () => {
  it("reads URL, S and --code", () => {
    expect(parseLoadTestArgs(["https://x.run.app", "10", "--code", "abc"])).toEqual({
      url: "https://x.run.app",
      sessions: 10,
      code: "abc",
    });
  });

  it("reads --real with --clips", () => {
    const options = parseLoadTestArgs(["http://h", "2", "--code", "c", "--real", "--clips", "/d"]);
    expect(options.real).toEqual({ clipsDir: "/d" });
  });

  it.each([
    ["no arguments", []],
    ["no S", ["http://h", "--code", "c"]],
    ["extra positional", ["http://h", "2", "3", "--code", "c"]],
    ["S of zero", ["http://h", "0", "--code", "c"]],
    ["S not a number", ["http://h", "many", "--code", "c"]],
    ["S with a decimal", ["http://h", "2.5", "--code", "c"]],
    ["URL without a scheme", ["h.example", "2", "--code", "c"]],
    ["no --code", ["http://h", "2"]],
    ["empty --code", ["http://h", "2", "--code", ""]],
    ["--real without --clips", ["http://h", "2", "--code", "c", "--real"]],
    ["--clips without --real", ["http://h", "2", "--code", "c", "--clips", "/d"]],
    ["an unknown flag", ["http://h", "2", "--code", "c", "--bogus"]],
  ])("rejects %s", (_name, argv) => {
    expect(() => parseLoadTestArgs(argv)).toThrow(UsageError);
  });
});

describe("load-test.ts as a command", () => {
  it("exits 0 and prints the summary when every session passes", async () => {
    const url = await startApp();
    const { stdout } = await run("node", ["deploy/load-test.ts", url, "3", "--code", CODE]);
    expect(stdout).toContain("fallback causes: none");
    expect(stdout).toContain("PASS");
  });

  it("exits 1 when a session reports a problem", async () => {
    const url = await startApp();
    const failed = run("node", ["deploy/load-test.ts", url, "2", "--code", "wrong"]);
    await expect(failed).rejects.toMatchObject({ code: 1 });
  });

  it("exits 2 and prints usage for bad arguments", async () => {
    const failed = run("node", ["deploy/load-test.ts", "http://h"]);
    await expect(failed).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("usage"),
    });
  });
});
