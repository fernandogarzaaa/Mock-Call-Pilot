import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreconditionFailed } from "../types/index.ts";
import { FsStorage } from "./fs.ts";

const SECRET = "test-signing-secret";
const T0 = 1_800_000_000_000;

let dir: string;
let clock: number;

function makeStorage(): FsStorage {
  return new FsStorage(dir, SECRET, () => clock);
}

function parseUrl(url: string): { key: string; exp: string; sig: string } {
  const match = /^\/files\/(.+)\?exp=(\d+)&sig=([A-Za-z0-9_-]+)$/.exec(url);
  if (!match) throw new Error(`unexpected url shape: ${url}`);
  return { key: match[1] as string, exp: match[2] as string, sig: match[3] as string };
}

function expectedSig(key: string, exp: number | string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${key}:${exp}`).digest("base64url");
}

async function expectStale(attempt: Promise<unknown>): Promise<void> {
  await expect(attempt).rejects.toBeInstanceOf(PreconditionFailed);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fs-storage-"));
  clock = T0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FsStorage JSON objects", () => {
  it("returns null for an object that was never written", async () => {
    expect(await makeStorage().getJson("sessions/a/state.json")).toBeNull();
  });

  it("creates with '0' and reads back the value with the new generation", async () => {
    const storage = makeStorage();
    const generation = await storage.putJson("sessions/a/state.json", { turns: [1, 2] }, "0");

    expect(generation).not.toBe("0");
    expect(await storage.getJson("sessions/a/state.json")).toEqual({
      value: { turns: [1, 2] },
      generation,
    });
  });

  it("rejects '0' when the object exists and leaves the stored value alone", async () => {
    const storage = makeStorage();
    await storage.putJson("k.json", { v: 1 }, "0");

    await expectStale(storage.putJson("k.json", { v: 2 }, "0"));
    expect((await storage.getJson<{ v: number }>("k.json"))?.value).toEqual({ v: 1 });
  });

  it("rejects a stale generation and accepts the current one", async () => {
    const storage = makeStorage();
    const first = await storage.putJson("k.json", { v: 1 }, "0");
    const second = await storage.putJson("k.json", { v: 2 }, first);

    expect(second).not.toBe(first);
    await expectStale(storage.putJson("k.json", { v: 3 }, first));
    expect(await storage.getJson("k.json")).toEqual({ value: { v: 2 }, generation: second });
  });

  it("rejects a generation for an object that does not exist", async () => {
    await expectStale(makeStorage().putJson("k.json", {}, "5"));
  });

  it("lets exactly one of three concurrent writers holding the same generation win", async () => {
    const storage = makeStorage();
    const base = await storage.putJson("k.json", { v: 0 }, "0");

    const results = await Promise.allSettled([
      storage.putJson("k.json", { v: 1 }, base),
      storage.putJson("k.json", { v: 2 }, base),
      storage.putJson("k.json", { v: 3 }, base),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(2);
    for (const failure of lost) expect(failure.reason).toBeInstanceOf(PreconditionFailed);
  });

  it("lets only one of two concurrent creators of the same key succeed", async () => {
    const storage = makeStorage();
    const results = await Promise.allSettled([
      storage.putJson("k.json", { v: 1 }, "0"),
      storage.putJson("k.json", { v: 2 }, "0"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("keeps accepting writes to a key after an earlier write to it failed", async () => {
    const storage = makeStorage();
    const first = await storage.putJson("k.json", { v: 1 }, "0");
    await expectStale(storage.putJson("k.json", { v: 2 }, "0"));
    await expect(storage.putJson("k.json", { v: 3 }, first)).resolves.toBeTypeOf("string");
  });

  it("stores different keys independently", async () => {
    const storage = makeStorage();
    const [a, b] = await Promise.all([
      storage.putJson("a.json", { id: "a" }, "0"),
      storage.putJson("b.json", { id: "b" }, "0"),
    ]);
    expect(await storage.getJson("a.json")).toEqual({ value: { id: "a" }, generation: a });
    expect(await storage.getJson("b.json")).toEqual({ value: { id: "b" }, generation: b });
  });

  it("is visible to a second instance over the same directory", async () => {
    const generation = await makeStorage().putJson("k.json", { v: 1 }, "0");
    expect(await makeStorage().getJson("k.json")).toEqual({ value: { v: 1 }, generation });
  });
});

describe("FsStorage binary objects", () => {
  it("stores bytes with their MIME type for read()", async () => {
    const storage = makeStorage();
    await storage.put("sessions/a/audio.mp4", new Uint8Array([0, 1, 2, 250, 255]), "audio/mp4");

    const stored = await storage.read("sessions/a/audio.mp4");
    expect(stored?.mime).toBe("audio/mp4");
    expect([...(stored?.bytes ?? [])]).toEqual([0, 1, 2, 250, 255]);
  });

  it("returns null when reading a missing object", async () => {
    expect(await makeStorage().read("sessions/a/audio.mp4")).toBeNull();
  });

  it("reports application/json for objects written with putJson", async () => {
    const storage = makeStorage();
    await storage.putJson("t.json", { a: 1 }, "0");

    const stored = await storage.read("t.json");
    expect(stored?.mime).toBe("application/json");
    expect(JSON.parse(Buffer.from(stored?.bytes ?? []).toString("utf8"))).toEqual({ a: 1 });
  });

  it("overwrites without a precondition and invalidates earlier generations", async () => {
    const storage = makeStorage();
    const first = await storage.putJson("k.json", { v: 1 }, "0");
    await storage.put("k.json", new TextEncoder().encode('{"v":9}'), "application/json");

    const after = await storage.getJson<{ v: number }>("k.json");
    expect(after?.value).toEqual({ v: 9 });
    expect(after?.generation).not.toBe(first);
    await expectStale(storage.putJson("k.json", { v: 2 }, first));
  });

  it("counts as existing for create-only writes after a first put", async () => {
    const storage = makeStorage();
    await storage.put("k.json", new TextEncoder().encode("{}"), "application/json");
    await expectStale(storage.putJson("k.json", {}, "0"));
  });
});

describe("FsStorage signed URLs", () => {
  it("builds /files/<key>?exp=<unix>&sig=<hmac> over '<key>:<exp>'", async () => {
    const url = await makeStorage().readUrl("sessions/a/audio.mp4", 3600);
    const { key, exp, sig } = parseUrl(url);

    expect(key).toBe("sessions/a/audio.mp4");
    expect(Number(exp)).toBe(T0 / 1000 + 3600);
    expect(sig).toBe(expectedSig(key, exp));
  });

  it("stays valid for at least ttlSec when the clock is not on a whole second", async () => {
    clock = T0 + 400;
    const { exp } = parseUrl(await makeStorage().readUrl("k.mp4", 10));
    expect(Number(exp) * 1000).toBeGreaterThanOrEqual(clock + 10_000);
  });

  it("verifies a URL it issued, with the expiry as a string or a number", async () => {
    const storage = makeStorage();
    const { key, exp, sig } = parseUrl(await storage.readUrl("sessions/a/audio.mp4", 3600));

    expect(storage.verify(key, exp, sig)).toBe(true);
    expect(storage.verify(key, Number(exp), sig)).toBe(true);
  });

  it("verifies in a second instance that shares the secret", async () => {
    const { key, exp, sig } = parseUrl(await makeStorage().readUrl("a.mp4", 60));
    expect(makeStorage().verify(key, exp, sig)).toBe(true);
  });

  it("is valid until the expiry second and rejected from then on", async () => {
    const storage = makeStorage();
    const { key, exp, sig } = parseUrl(await storage.readUrl("a.mp4", 3600));
    const expiryMs = Number(exp) * 1000;

    clock = expiryMs - 1;
    expect(storage.verify(key, exp, sig)).toBe(true);
    clock = expiryMs;
    expect(storage.verify(key, exp, sig)).toBe(false);
    clock = expiryMs + 86_400_000;
    expect(storage.verify(key, exp, sig)).toBe(false);
  });

  it("rejects a correct signature presented for a different key", async () => {
    const storage = makeStorage();
    const { exp, sig } = parseUrl(await storage.readUrl("a.mp4", 3600));
    expect(storage.verify("b.mp4", exp, sig)).toBe(false);
  });

  it("rejects a URL whose expiry was extended", async () => {
    const storage = makeStorage();
    const { key, exp, sig } = parseUrl(await storage.readUrl("a.mp4", 3600));

    expect(storage.verify(key, Number(exp) + 1, sig)).toBe(false);
    expect(storage.verify(key, String(Number(exp) + 1), sig)).toBe(false);
  });

  it("rejects a signature from another secret", async () => {
    const storage = makeStorage();
    const { key, exp } = parseUrl(await storage.readUrl("a.mp4", 3600));
    expect(storage.verify(key, exp, expectedSig(key, exp, "other-secret"))).toBe(false);
  });

  it("rejects a mangled, truncated, extended or empty signature", async () => {
    const storage = makeStorage();
    const { key, exp, sig } = parseUrl(await storage.readUrl("a.mp4", 3600));
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;

    expect(storage.verify(key, exp, flipped)).toBe(false);
    expect(storage.verify(key, exp, `${sig}x`)).toBe(false);
    expect(storage.verify(key, exp, sig.slice(0, -1))).toBe(false);
    expect(storage.verify(key, exp, "")).toBe(false);
  });

  it("rejects an expiry that is not a whole number of seconds", async () => {
    const storage = makeStorage();
    const future = T0 / 1000 + 3600;

    for (const bad of ["", "abc", "1e12", "-5", "12.5", " 1", Number.NaN, 12.5]) {
      expect(storage.verify("a.mp4", bad, expectedSig("a.mp4", String(bad)))).toBe(false);
    }
    expect(storage.verify("a.mp4", future, expectedSig("a.mp4", future))).toBe(true);
  });

  it("refuses an empty signing secret", () => {
    expect(() => new FsStorage(dir, "")).toThrow();
  });
});

describe("FsStorage keys", () => {
  const badKeys = [
    "../escape.json",
    "a/../../escape.json",
    "/absolute.json",
    "a//b.json",
    "a/./b.json",
    "a/.",
    "",
    "has space.json",
    "q?x=1.json",
    "back\\slash.json",
    "obj.gen",
    "obj.mime",
  ];

  it.each(badKeys)("rejects key %j everywhere", async (key) => {
    const storage = makeStorage();

    await expect(storage.getJson(key)).rejects.toThrow();
    await expect(storage.putJson(key, {}, "0")).rejects.toThrow();
    await expect(storage.put(key, new Uint8Array([1]), "x/y")).rejects.toThrow();
    await expect(storage.readUrl(key, 60)).rejects.toThrow();
    expect(await storage.read(key)).toBeNull();
  });

  it("does not let a sidecar file be read as an object", async () => {
    const storage = makeStorage();
    await storage.putJson("obj", { a: 1 }, "0");

    expect(await storage.read("obj.gen")).toBeNull();
    expect(await storage.read("obj.mime")).toBeNull();
  });

  it("accepts base64url ids in nested keys", async () => {
    const key = "sessions/Ab_-09xYz/state.json";
    await expect(makeStorage().putJson(key, { ok: true }, "0")).resolves.toBeTypeOf("string");
  });
});
