import { AwsClient } from "aws4fetch";
import { describe, expect, it } from "vitest";
import { PreconditionFailed } from "../types/index.ts";
import { R2Storage, type S3Signer } from "./r2.ts";

const ENDPOINT = "https://acct.r2.cloudflarestorage.com";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(responses: Response[]) {
  const calls: Call[] = [];
  const signer: S3Signer = {
    async fetch(url, init) {
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body,
      });
      const next = responses.shift();
      if (!next) throw new Error("no response queued");
      return next;
    },
    async sign(url, init) {
      return new Request(url, init);
    },
  };
  return { signer, calls, storage: new R2Storage(signer, `${ENDPOINT}/`, "pilot") };
}

const etag = (value: string, status = 200, body: string | null = null) =>
  new Response(body, { status, headers: { etag: value } });

describe("R2Storage.getJson", () => {
  it("returns the body and its ETag from one GET", async () => {
    const { storage, calls } = stub([etag('"abc"', 200, '{"stage":"d1_attention"}')]);
    const got = await storage.getJson<{ stage: string }>("sessions/x/state.json");
    expect(got).toEqual({ value: { stage: "d1_attention" }, generation: '"abc"' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${ENDPOINT}/pilot/sessions/x/state.json`,
    });
  });

  it("returns null for a missing object", async () => {
    const { storage } = stub([new Response(null, { status: 404 })]);
    expect(await storage.getJson("sessions/x/state.json")).toBeNull();
  });

  it("throws on other errors and on a missing ETag", async () => {
    const failing = stub([new Response(null, { status: 500 })]);
    await expect(failing.storage.getJson("k")).rejects.toThrow("500");
    const bare = stub([new Response("{}", { status: 200 })]);
    await expect(bare.storage.getJson("k")).rejects.toThrow("no ETag");
  });
});

describe("R2Storage.putJson", () => {
  it('creates only if absent when the generation is "0"', async () => {
    const { storage, calls } = stub([etag('"new"')]);
    expect(await storage.putJson("sessions/x/state.json", { a: 1 }, "0")).toBe('"new"');
    expect(calls[0]?.headers).toMatchObject({
      "if-none-match": "*",
      "content-type": "application/json",
    });
    expect(calls[0]?.headers["if-match"]).toBeUndefined();
    expect(calls[0]?.body).toBe('{"a":1}');
  });

  it("writes only over the ETag it read", async () => {
    const { storage, calls } = stub([etag('"v2"')]);
    expect(await storage.putJson("k", { a: 2 }, '"v1"')).toBe('"v2"');
    expect(calls[0]?.headers["if-match"]).toBe('"v1"');
    expect(calls[0]?.headers["if-none-match"]).toBeUndefined();
  });

  it("maps 412 and 409 to PreconditionFailed", async () => {
    for (const status of [412, 409]) {
      const { storage } = stub([new Response(null, { status })]);
      await expect(storage.putJson("k", {}, '"v1"')).rejects.toBeInstanceOf(PreconditionFailed);
    }
  });

  it("rethrows other failures and refuses a write with no ETag back", async () => {
    const failing = stub([new Response(null, { status: 403 })]);
    const error = await failing.storage.putJson("k", {}, "0").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PreconditionFailed);
    const bare = stub([new Response(null, { status: 200 })]);
    await expect(bare.storage.putJson("k", {}, "0")).rejects.toThrow("no ETag");
  });
});

describe("R2Storage.put", () => {
  it("uploads the bytes with their content type and no condition", async () => {
    const { storage, calls } = stub([new Response(null, { status: 200 })]);
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put("sessions/x/audio.webm", bytes, "audio/webm");
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: `${ENDPOINT}/pilot/sessions/x/audio.webm`,
      headers: { "content-type": "audio/webm" },
      body: bytes,
    });
    expect(calls[0]?.headers["if-match"]).toBeUndefined();
  });

  it("throws when the upload fails", async () => {
    const { storage } = stub([new Response(null, { status: 500 })]);
    await expect(storage.put("k", new Uint8Array(), "audio/webm")).rejects.toThrow("500");
  });
});

describe("R2Storage.readUrl", () => {
  it("presigns a GET that needs no login and expires after ttlSec", async () => {
    const client = new AwsClient({
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret",
      service: "s3",
      region: "auto",
    });
    const storage = new R2Storage(client, ENDPOINT, "pilot");
    const url = new URL(await storage.readUrl("sessions/x/audio.webm", 3600));
    expect(`${url.origin}${url.pathname}`).toBe(`${ENDPOINT}/pilot/sessions/x/audio.webm`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^AKIDEXAMPLE\/\d{8}\/auto\/s3\//);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("encodes each key segment but keeps the slashes", async () => {
    const { storage } = stub([]);
    const url = await storage.readUrl("sessions/a b/audio.webm", 60);
    expect(url).toContain("/pilot/sessions/a%20b/audio.webm?");
  });
});
