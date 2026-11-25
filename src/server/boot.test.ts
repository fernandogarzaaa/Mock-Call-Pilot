import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_BANNER } from "./views.ts";

// Running the real entry point catches anything Node's type stripping rejects but vitest accepts.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASE_ENV = { STORAGE: "fs", STT: "fake", PICKER: "fake", PORT: "0" };

const children: { kill(): boolean }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function spawnServer(env: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "mock-call-boot-"));
  dirs.push(dir);
  const child = spawn(process.execPath, ["src/server/main.ts"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", STORAGE_DIR: dir, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}
type Server = Awaited<ReturnType<typeof spawnServer>>;

function listeningPort(child: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = /listening on (\d+)/.exec(output);
      if (match) resolve(Number(match[1]));
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("exit", (code) =>
      reject(new Error(`server exited early with code ${code}: ${stderr}`)),
    );
  });
}

function runToExit(child: Server): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("close", (code) => resolve({ code, stderr }));
  });
}

async function pollHealthz(port: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) return res;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`/healthz never answered: ${String(lastError)}`);
}

describe("booting the real entry point", () => {
  it("starts in demo mode on fakes and serves the call page", { timeout: 30_000 }, async () => {
    const child = await spawnServer({ ...BASE_ENV, MODE: "demo" });
    const port = await listeningPort(child);
    expect(port).toBeGreaterThan(0);

    const health = await pollHealthz(port);
    expect(await health.text()).toBe("ok");

    const call = await fetch(`http://127.0.0.1:${port}/call?code=demo`);
    expect(call.status).toBe(200);
    expect(await call.text()).toContain(DEMO_BANNER);
    const script = await fetch(`http://127.0.0.1:${port}/static/call.js`);
    expect(script.status).toBe(200);
  });

  it("runs a whole call against the booted server", { timeout: 30_000 }, async () => {
    const child = await spawnServer({ ...BASE_ENV, MODE: "demo", ACCESS_CODE: "boot-code" });
    const port = await listeningPort(child);
    await pollHealthz(port);
    const base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "boot-code", name: "Boot Tester" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const turn = new FormData();
    turn.append("audio", new Blob(["hello there"], { type: "audio/webm" }), "turn.webm");
    turn.append("mime", "audio/webm");
    turn.append("turnIndex", "0");
    turn.append("clientMs", "500");
    const turnRes = await fetch(`${base}/api/s/${id}/turn`, { method: "POST", body: turn });
    expect(turnRes.status).toBe(200);

    const end = new FormData();
    end.append("audio", new Blob(["whole call"], { type: "audio/webm" }), "call.webm");
    end.append("mime", "audio/webm");
    end.append("reason", "candidate_ended");
    const endRes = await fetch(`${base}/api/s/${id}/end`, { method: "POST", body: end });
    expect(endRes.status).toBe(200);
    expect(((await endRes.json()) as { url: string }).url).toBe(`${base}/r/${id}`);

    const audio = await fetch(`${base}/r/${id}/audio`);
    expect(audio.status).toBe(200);
    expect(await audio.text()).toBe("whole call");
    expect(await (await fetch(`${base}/r/${id}`)).text()).toContain("Boot Tester");
  });

  it("exits 1 in live mode and names every missing value", { timeout: 30_000 }, async () => {
    const child = await spawnServer({ ...BASE_ENV, MODE: "live" });
    const { code, stderr } = await runToExit(child);
    expect(code).toBe(1);
    expect(stderr).toContain("gaps.retentionDays");
    expect(stderr).toContain("env.ACCESS_CODE");
    // The persona is filled from Rhieza's script, so it is no longer named as a gap.
    expect(stderr).not.toContain("persona.firstName");
    expect(stderr).not.toContain("persona.companyName");
    expect(stderr).not.toContain("persona.fleetSize");
    // Every objection is still unapproved, so all seven are named.
    for (const id of [
      "obj.busy",
      "obj.notinterested",
      "obj.havetelematics",
      "obj.sendinfo",
      "obj.nobudget",
      "obj.callback",
      "obj.thinkaboutit",
    ]) {
      expect(stderr).toContain(`objections.${id}.approved`);
    }
  });

  it("exits 1 when a real adapter is chosen without its key", { timeout: 30_000 }, async () => {
    const child = await spawnServer({ ...BASE_ENV, MODE: "demo", STT: "scribe" });
    const { code, stderr } = await runToExit(child);
    expect(code).toBe(1);
    expect(stderr).toContain("env.ELEVENLABS_API_KEY");
  });
});
