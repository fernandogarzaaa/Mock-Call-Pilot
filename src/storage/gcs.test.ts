import type { Bucket } from "@google-cloud/storage";
import { describe, expect, it } from "vitest";
import { PreconditionFailed } from "../types/index.ts";
import { type GcsBucket, type GcsFile, GcsStorage } from "./gcs.ts";

function httpError(code: number): Error {
  return Object.assign(new Error(`http ${code}`), { code });
}

interface Script {
  /** One entry per getMetadata() call: a generation, or an error to throw. */
  metadata?: (Error | string | number)[];
  /** One entry per download() call: the body, or an error to throw. */
  downloads?: (Error | string)[];
  /** What save() does; returns the generation to leave in file.metadata. */
  save?: (data: unknown, options: unknown) => number | string | undefined;
  signedUrl?: string;
}

function stub(script: Script) {
  const calls: string[] = [];
  const saves: { key: string; data: unknown; options: unknown }[] = [];
  const signed: { key: string; config: unknown }[] = [];
  const metadata = [...(script.metadata ?? [])];
  const downloads = [...(script.downloads ?? [])];

  const bucket: GcsBucket = {
    file(key, options) {
      calls.push(`file:${key}:${options?.generation ?? "latest"}`);
      const file: GcsFile = {
        metadata: {},
        async getMetadata() {
          calls.push("getMetadata");
          const next = metadata.shift();
          if (next instanceof Error) throw next;
          return next === undefined ? [{}] : [{ generation: next }];
        },
        async download() {
          calls.push("download");
          const next = downloads.shift();
          if (next instanceof Error) throw next;
          return [Buffer.from(next ?? "null")];
        },
        async save(data, saveOptions) {
          calls.push("save");
          saves.push({ key, data, options: saveOptions });
          const generation = script.save?.(data, saveOptions);
          if (generation !== undefined) file.metadata = { generation };
        },
        async getSignedUrl(config) {
          signed.push({ key, config });
          return [script.signedUrl ?? "https://signed.example/x"];
        },
      };
      return file;
    },
  };
  return { bucket, calls, saves, signed };
}

describe("GcsStorage.getJson", () => {
  it("reads the metadata first, then downloads that exact generation", async () => {
    const { bucket, calls } = stub({
      metadata: ["1700000000000042"],
      downloads: ['{"turns":[1]}'],
    });

    const result = await new GcsStorage(bucket).getJson("sessions/a/state.json");

    expect(result).toEqual({ value: { turns: [1] }, generation: "1700000000000042" });
    expect(calls).toEqual([
      "file:sessions/a/state.json:latest",
      "getMetadata",
      "file:sessions/a/state.json:1700000000000042",
      "download",
    ]);
  });

  it("returns the generation as a string even when the API reports a number", async () => {
    const { bucket } = stub({ metadata: [42], downloads: ["{}"] });
    expect((await new GcsStorage(bucket).getJson("k"))?.generation).toBe("42");
  });

  it("starts over when the download 404s because the generation was replaced", async () => {
    const { bucket, calls } = stub({
      metadata: ["1", "2"],
      downloads: [httpError(404), '{"v":2}'],
    });

    const result = await new GcsStorage(bucket).getJson("k");

    expect(result).toEqual({ value: { v: 2 }, generation: "2" });
    expect(calls).toEqual([
      "file:k:latest",
      "getMetadata",
      "file:k:1",
      "download",
      "file:k:latest",
      "getMetadata",
      "file:k:2",
      "download",
    ]);
  });

  it("succeeds on the third attempt after two replaced generations", async () => {
    const { bucket } = stub({
      metadata: ["1", "2", "3"],
      downloads: [httpError(404), httpError(404), '{"v":3}'],
    });

    const result = await new GcsStorage(bucket).getJson("k");
    expect(result).toEqual({ value: { v: 3 }, generation: "3" });
  });

  it("throws after 3 attempts that all hit a replaced generation", async () => {
    const { bucket, calls } = stub({
      metadata: ["1", "2", "3", "4"],
      downloads: [httpError(404), httpError(404), httpError(404), "{}"],
    });

    await expect(new GcsStorage(bucket).getJson("k")).rejects.toThrow(/3 reads/);
    expect(calls.filter((c) => c === "getMetadata")).toHaveLength(3);
    expect(calls.filter((c) => c === "download")).toHaveLength(3);
  });

  it("returns null when the object does not exist, without downloading", async () => {
    const { bucket, calls } = stub({ metadata: [httpError(404)] });

    expect(await new GcsStorage(bucket).getJson("k")).toBeNull();
    expect(calls).not.toContain("download");
  });

  it("returns null when a retry finds the object deleted", async () => {
    const { bucket } = stub({ metadata: ["1", httpError(404)], downloads: [httpError(404)] });
    expect(await new GcsStorage(bucket).getJson("k")).toBeNull();
  });

  it("does not retry other metadata errors", async () => {
    const boom = httpError(500);
    const { bucket, calls } = stub({ metadata: [boom, "1"], downloads: ["{}"] });

    await expect(new GcsStorage(bucket).getJson("k")).rejects.toBe(boom);
    expect(calls.filter((c) => c === "getMetadata")).toHaveLength(1);
  });

  it("does not retry other download errors", async () => {
    const boom = httpError(503);
    const { bucket, calls } = stub({ metadata: ["1", "2"], downloads: [boom, "{}"] });

    await expect(new GcsStorage(bucket).getJson("k")).rejects.toBe(boom);
    expect(calls.filter((c) => c === "download")).toHaveLength(1);
  });

  it("does not retry a body that is not JSON", async () => {
    const { bucket, calls } = stub({ metadata: ["1", "2"], downloads: ["not json", "{}"] });

    await expect(new GcsStorage(bucket).getJson("k")).rejects.toThrow(SyntaxError);
    expect(calls.filter((c) => c === "download")).toHaveLength(1);
  });

  it("does not mistake a string error code for a 404", async () => {
    const odd = Object.assign(new Error("odd"), { code: "404" });
    const { bucket } = stub({ metadata: [odd] });

    await expect(new GcsStorage(bucket).getJson("k")).rejects.toBe(odd);
  });

  it("throws when Cloud Storage reports no generation", async () => {
    const { bucket } = stub({ metadata: [] });
    await expect(new GcsStorage(bucket).getJson("k")).rejects.toThrow(/no generation/);
  });
});

describe("GcsStorage.putJson", () => {
  it("saves non-resumable JSON with the precondition and returns the new generation", async () => {
    const { bucket, saves, calls } = stub({ save: () => 1700000000000099 });

    const storage = new GcsStorage(bucket);
    const generation = await storage.putJson("sessions/a/state.json", { v: 1 }, "7");

    expect(generation).toBe("1700000000000099");
    expect(calls[0]).toBe("file:sessions/a/state.json:latest");
    expect(saves).toEqual([
      {
        key: "sessions/a/state.json",
        data: '{"v":1}',
        options: {
          resumable: false,
          contentType: "application/json",
          preconditionOpts: { ifGenerationMatch: "7" },
        },
      },
    ]);
  });

  it("passes '0' through as a create-only precondition", async () => {
    const { bucket, saves } = stub({ save: () => 1 });

    await new GcsStorage(bucket).putJson("k", {}, "0");
    expect(saves[0]?.options).toMatchObject({ preconditionOpts: { ifGenerationMatch: "0" } });
  });

  it("maps HTTP 412 to PreconditionFailed", async () => {
    const { bucket } = stub({
      save: () => {
        throw httpError(412);
      },
    });

    const failure = new GcsStorage(bucket).putJson("k", {}, "3");
    await expect(failure).rejects.toBeInstanceOf(PreconditionFailed);
  });

  it("rethrows other errors untouched", async () => {
    const boom = httpError(500);
    const { bucket } = stub({
      save: () => {
        throw boom;
      },
    });

    const failure = new GcsStorage(bucket).putJson("k", {}, "3");
    await expect(failure).rejects.toBe(boom);
  });

  it("throws rather than return a made-up generation when none comes back", async () => {
    const { bucket } = stub({ save: () => undefined });
    await expect(new GcsStorage(bucket).putJson("k", {}, "0")).rejects.toThrow(/no generation/);
  });
});

describe("GcsStorage.put", () => {
  it("saves the bytes with the given content type and no precondition", async () => {
    const { bucket, saves } = stub({});
    const bytes = new Uint8Array([1, 2, 3]);

    await new GcsStorage(bucket).put("sessions/a/audio.mp4", bytes, "audio/mp4");

    expect(saves).toHaveLength(1);
    expect(saves[0]?.key).toBe("sessions/a/audio.mp4");
    expect(saves[0]?.data).toBe(bytes);
    expect(saves[0]?.options).toEqual({ resumable: false, contentType: "audio/mp4" });
  });
});

describe("GcsStorage.readUrl", () => {
  it("returns a V4 read URL that expires ttlSec from now", async () => {
    const { bucket, signed } = stub({ signedUrl: "https://signed.example/audio?sig=1" });
    const storage = new GcsStorage(bucket, () => 1_800_000_000_000);

    const url = await storage.readUrl("a/audio.mp4", 3600);

    expect(url).toBe("https://signed.example/audio?sig=1");
    expect(signed).toEqual([
      {
        key: "a/audio.mp4",
        config: { version: "v4", action: "read", expires: 1_800_000_000_000 + 3_600_000 },
      },
    ]);
  });
});

describe("GcsStorage and the real client", () => {
  it("accepts a real @google-cloud/storage Bucket (compile-time check)", () => {
    const adapt = (bucket: Bucket): GcsStorage => new GcsStorage(bucket);
    expect(adapt).toBeTypeOf("function");
  });
});
