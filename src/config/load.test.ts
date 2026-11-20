import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { PilotConfig, ScriptConfig } from "../types/index.ts";
import { ConfigError } from "../types/index.ts";
import { loadConfig } from "./load.ts";

const REAL_DIR = fileURLToPath(new URL("../../config", import.meta.url));
const GAP_KEYS = [
  "interviewFlow",
  "testWindow",
  "retentionDays",
  "sourceLiveTest",
  "taskInstructions",
  "callerCompanyName",
  "maxCallMinutes",
] as const;

const LIVE_ENV = {
  MODE: "live",
  ACCESS_CODE: "s3cret",
  STT: "scribe",
  PICKER: "claude",
  ANTHROPIC_API_KEY: "a-key",
  ELEVENLABS_API_KEY: "e-key",
};
const DEMO_ENV = { MODE: "demo" };

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readReal<T>(file: string): T {
  return JSON.parse(readFileSync(join(REAL_DIR, file), "utf8")) as T;
}

/** A config folder that is ready for live mode; `edit` changes it before it is written. */
function makeDir(edit?: (script: ScriptConfig, pilot: PilotConfig) => void): string {
  const script = readReal<ScriptConfig>("script.json");
  const pilot = readReal<PilotConfig>("pilot.json");
  script.persona = { firstName: "Dana", companyName: "Acme Haulage", fleetSize: 25 };
  for (const line of script.lines) line.approved = true;
  for (const objection of script.objections) objection.approved = true;
  script.fallbackLine.approved = true;
  pilot.gaps = {
    interviewFlow: "flow",
    testWindow: "window",
    retentionDays: 30,
    sourceLiveTest: "live test",
    taskInstructions: "Call {callerCompanyName} prospects.",
    callerCompanyName: "Can-Am Telematics",
    maxCallMinutes: 12,
  };
  edit?.(script, pilot);
  const dir = mkdtempSync(join(tmpdir(), "config-test-"));
  tmpDirs.push(dir);
  writeFileSync(join(dir, "script.json"), JSON.stringify(script));
  writeFileSync(join(dir, "pilot.json"), JSON.stringify(pilot));
  return dir;
}

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected loadConfig to throw a ConfigError");
}

function names(problems: string[], path: string): boolean {
  return problems.some((problem) => problem.startsWith(`${path}:`));
}

describe("loadConfig in live mode", () => {
  it("loads a complete config and fills the persona into the lines", () => {
    const dir = makeDir((script) => {
      script.lines[0].text = "Hi {firstName} at {companyName}, {fleetSize} trucks";
    });
    const config = loadConfig(dir, LIVE_ENV);
    expect(config.mode).toBe("live");
    expect(config.script.lines[0].text).toBe("Hi Dana at Acme Haulage, 25 trucks");
    expect(config.maxCallMinutes).toBe(12);
    expect(config.maxCallMinutesIsDemo).toBe(false);
    expect(config.accessCode).toBe("s3cret");
    expect(config.noticeText).toContain("deleted after 30 days");
    expect(config.taskInstructions).toBe("Call Can-Am Telematics prospects.");
  });

  it.each(GAP_KEYS)("names a null gap: %s", (key) => {
    const dir = makeDir((_script, pilot) => {
      pilot.gaps[key] = null;
    });
    const problems = problemsOf(() => loadConfig(dir, LIVE_ENV));
    expect(problems).toHaveLength(1);
    expect(names(problems, `gaps.${key}`)).toBe(true);
  });

  it.each(["firstName", "companyName", "fleetSize"] as const)(
    "names a null persona field: %s",
    (key) => {
      const dir = makeDir((script) => {
        script.persona[key] = null;
      });
      const problems = problemsOf(() => loadConfig(dir, LIVE_ENV));
      expect(problems).toHaveLength(1);
      expect(names(problems, `persona.${key}`)).toBe(true);
    },
  );

  it("names an unapproved line, objection and fallback line", () => {
    const dir = makeDir((script) => {
      script.lines[4].approved = false;
      script.objections[1].approved = false;
      script.fallbackLine.approved = false;
    });
    const problems = problemsOf(() => loadConfig(dir, LIVE_ENV));
    expect(problems).toHaveLength(3);
    expect(names(problems, "lines.d2.listen.approved")).toBe(true);
    expect(names(problems, "objections.obj.notinterested.approved")).toBe(true);
    expect(names(problems, "fallbackLine.approved")).toBe(true);
  });

  it("names an unset or empty ACCESS_CODE", () => {
    for (const code of [undefined, ""]) {
      const problems = problemsOf(() => loadConfig(makeDir(), { ...LIVE_ENV, ACCESS_CODE: code }));
      expect(problems).toHaveLength(1);
      expect(names(problems, "env.ACCESS_CODE")).toBe(true);
    }
  });

  it("refuses fake adapters", () => {
    const stt = problemsOf(() => loadConfig(makeDir(), { ...LIVE_ENV, STT: "fake" }));
    expect(stt).toHaveLength(1);
    expect(names(stt, "env.STT")).toBe(true);
    const picker = problemsOf(() => loadConfig(makeDir(), { ...LIVE_ENV, PICKER: "fake" }));
    expect(picker).toHaveLength(1);
    expect(names(picker, "env.PICKER")).toBe(true);
  });

  it("names a missing API key for each real adapter", () => {
    const stt = problemsOf(() =>
      loadConfig(makeDir(), { ...LIVE_ENV, ELEVENLABS_API_KEY: undefined }),
    );
    expect(stt).toHaveLength(1);
    expect(names(stt, "env.ELEVENLABS_API_KEY")).toBe(true);
    const picker = problemsOf(() =>
      loadConfig(makeDir(), { ...LIVE_ENV, ANTHROPIC_API_KEY: undefined }),
    );
    expect(picker).toHaveLength(1);
    expect(names(picker, "env.ANTHROPIC_API_KEY")).toBe(true);
  });

  it("does not ask for a key whose adapter is not used", () => {
    // Fake adapters are refused, so the only error is the adapter itself, not a key.
    const problems = problemsOf(() =>
      loadConfig(makeDir(), {
        ...LIVE_ENV,
        STT: "fake",
        PICKER: "fake",
        ELEVENLABS_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
      }),
    );
    expect(problems.map((problem) => problem.split(":")[0]).sort()).toEqual([
      "env.PICKER",
      "env.STT",
    ]);
  });

  it("lists every failure in one error", () => {
    const dir = makeDir((script, pilot) => {
      pilot.gaps.retentionDays = null;
      script.persona.firstName = null;
      script.lines[4].approved = false;
    });
    let error: unknown;
    try {
      loadConfig(dir, { MODE: "live" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    for (const path of [
      "gaps.retentionDays",
      "persona.firstName",
      "lines.d2.listen.approved",
      "env.ACCESS_CODE",
      "env.ELEVENLABS_API_KEY",
      "env.ANTHROPIC_API_KEY",
    ]) {
      expect(message).toContain(path);
    }
  });

  it("fails the real config folder, naming every open gap (CUJ 5)", () => {
    const problems = problemsOf(() => loadConfig(REAL_DIR, LIVE_ENV));
    for (const key of GAP_KEYS) expect(names(problems, `gaps.${key}`)).toBe(true);
    for (const key of ["firstName", "companyName", "fleetSize"]) {
      expect(names(problems, `persona.${key}`)).toBe(true);
    }
    expect(names(problems, "lines.d2.next.approved")).toBe(true);
    expect(names(problems, "fallbackLine.approved")).toBe(true);
    expect(names(problems, "objections.obj.busy.approved")).toBe(true);
  });
});

describe("loadConfig in demo mode", () => {
  it("loads the real config folder with placeholders and demo defaults", () => {
    const config = loadConfig(REAL_DIR, DEMO_ENV);
    expect(config.mode).toBe("demo");
    expect(config.accessCode).toBe("demo");
    expect(config.maxCallMinutes).toBe(15);
    expect(config.maxCallMinutesIsDemo).toBe(true);
    expect(config.taskInstructions).toBe("PLACEHOLDER: not client-approved");
    expect(config.noticeText).toContain("deleted after [not yet set] days");
    expect(config.noticeText).not.toContain("{");
    expect(config.script.lines.find((line) => line.id === "d1.who")?.text).toBe("Who is this...");
  });

  it("uses ACCESS_CODE and gaps.maxCallMinutes when they are set", () => {
    const config = loadConfig(makeDir(), { MODE: "demo", ACCESS_CODE: "mine" });
    expect(config.accessCode).toBe("mine");
    expect(config.maxCallMinutes).toBe(12);
    expect(config.maxCallMinutesIsDemo).toBe(false);
  });

  it("falls back to demo for an empty ACCESS_CODE", () => {
    expect(loadConfig(makeDir(), { MODE: "demo", ACCESS_CODE: "" }).accessCode).toBe("demo");
  });

  it("shows null persona values and a null caller company as visible placeholders", () => {
    const dir = makeDir((script, pilot) => {
      script.persona = { firstName: null, companyName: null, fleetSize: null };
      script.lines[0].text = "{firstName} / {companyName} / {fleetSize}";
      pilot.gaps.callerCompanyName = null;
    });
    const config = loadConfig(dir, DEMO_ENV);
    expect(config.script.lines[0].text).toBe(
      "[firstName not set] / [companyName not set] / [fleetSize not set]",
    );
    expect(config.taskInstructions).toBe("Call PLACEHOLDER: not client-approved prospects.");
  });
});

describe("loadConfig validation in every mode", () => {
  const envs = [DEMO_ENV, LIVE_ENV];

  it.each(envs)("rejects fleetSize 9 (%o)", (env) => {
    const dir = makeDir((script) => {
      script.persona.fleetSize = 9;
    });
    expect(
      names(
        problemsOf(() => loadConfig(dir, env)),
        "persona.fleetSize",
      ),
    ).toBe(true);
  });

  it("accepts fleetSize 10", () => {
    const dir = makeDir((script) => {
      script.persona.fleetSize = 10;
    });
    expect(loadConfig(dir, DEMO_ENV).script.persona.fleetSize).toBe(10);
  });

  const unknownTokenCases: [string, string, string][] = [
    ["lines.d1.who.text", "{nope}", "lineText"],
    ["lines.d1.who.text", "{callerCompanyName}", "lineText"],
    ["objections.obj.busy.prospectLine", "{nope}", "prospectLine"],
    ["objections.obj.busy.callerReply", "{nope}", "callerReply"],
    ["fallbackLine.text", "{nope}", "fallback"],
    ["settings.recordingNotice", "{firstName}", "notice"],
    ["settings.clientDetails", "{firstName}", "clientDetails"],
    ["gaps.taskInstructions", "{retentionDays}", "taskInstructions"],
  ];

  function putToken(target: string, token: string, script: ScriptConfig, pilot: PilotConfig) {
    const text = `Hi ${token}`;
    if (target === "lineText") script.lines[0].text = text;
    if (target === "prospectLine") script.objections[0].prospectLine = text;
    if (target === "callerReply") script.objections[0].callerReply = text;
    if (target === "fallback") script.fallbackLine.text = text;
    if (target === "notice") pilot.settings.recordingNotice = `${text} {retentionDays}`;
    if (target === "clientDetails") pilot.settings.clientDetails = text;
    if (target === "taskInstructions") pilot.gaps.taskInstructions = text;
  }

  it.each(unknownTokenCases)("rejects an unknown token in %s (%s)", (path, token, target) => {
    for (const env of envs) {
      const dir = makeDir((script, pilot) => putToken(target, token, script, pilot));
      const problems = problemsOf(() => loadConfig(dir, env));
      expect(problems.some((p) => p.startsWith(`${path}:`) && p.includes(token))).toBe(true);
    }
  });

  it("substitutes tokens in every text and nowhere else", () => {
    const dir = makeDir((script) => {
      const text = "{firstName}|{companyName}|{fleetSize}";
      for (const line of script.lines) line.text = text;
      for (const objection of script.objections) {
        objection.prospectLine = text;
        objection.callerReply = text;
      }
      script.fallbackLine.text = text;
      // A value that looks like a token must come through untouched.
      script.persona.companyName = "Acme {fleetSize} Co";
    });
    const config = loadConfig(dir, DEMO_ENV);
    const expected = "Dana|Acme {fleetSize} Co|25";
    for (const line of config.script.lines) expect(line.text).toBe(expected);
    for (const objection of config.script.objections) {
      expect(objection.prospectLine).toBe(expected);
      expect(objection.callerReply).toBe(expected);
    }
    expect(config.script.fallbackLine.text).toBe(expected);
    expect(config.clientDetails).toBe(readReal<PilotConfig>("pilot.json").settings.clientDetails);
  });

  it("keeps non-text line fields as they were", () => {
    const config = loadConfig(REAL_DIR, DEMO_ENV);
    const source = readReal<ScriptConfig>("script.json");
    expect(config.script.lines.map(({ text: _t, ...rest }) => rest)).toEqual(
      source.lines.map(({ text: _t, ...rest }) => rest),
    );
    expect(config.script.stages).toEqual(source.stages);
  });
});

describe("loadConfig input errors", () => {
  it.each([undefined, "", "prod"])("rejects MODE %o", (mode) => {
    const problems = problemsOf(() => loadConfig(makeDir(), { MODE: mode }));
    expect(names(problems, "env.MODE")).toBe(true);
  });

  it("reports a missing file", () => {
    const dir = makeDir();
    rmSync(join(dir, "pilot.json"));
    expect(
      names(
        problemsOf(() => loadConfig(dir, DEMO_ENV)),
        "pilot.json",
      ),
    ).toBe(true);
  });

  it("reports malformed JSON", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "script.json"), "{ not json");
    expect(
      names(
        problemsOf(() => loadConfig(dir, DEMO_ENV)),
        "script.json",
      ),
    ).toBe(true);
  });

  it("reports a field of the wrong shape with its path", () => {
    const dir = makeDir();
    const script = JSON.parse(readFileSync(join(dir, "script.json"), "utf8"));
    script.lines[0].stage = "d9_unknown";
    writeFileSync(join(dir, "script.json"), JSON.stringify(script));
    const problems = problemsOf(() => loadConfig(dir, DEMO_ENV));
    expect(problems.some((p) => p.startsWith("script.json: lines.0.stage"))).toBe(true);
  });
});
