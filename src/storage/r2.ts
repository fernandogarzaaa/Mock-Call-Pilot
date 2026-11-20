import { PreconditionFailed, type Storage } from "../types/index.ts";

type SignInit = RequestInit & { aws?: { signQuery?: boolean } };

/** The slice of aws4fetch's `AwsClient` this adapter uses, so tests can stub it. */
export interface S3Signer {
  fetch(input: string, init?: SignInit): Promise<Response>;
  sign(input: string, init?: SignInit): Promise<Request>;
}

/**
 * Cloudflare R2 through its S3-compatible API. The object ETag plays the part of a Cloud Storage
 * generation: reads return it with the body in one GET, and writes are conditional on it.
 * The bucket stays private; audio is read through presigned GET URLs, which need no login.
 */
export class R2Storage implements Storage {
  private readonly signer: S3Signer;
  private readonly base: string;

  /** endpoint is https://<account id>.r2.cloudflarestorage.com */
  constructor(signer: S3Signer, endpoint: string, bucket: string) {
    this.signer = signer;
    this.base = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`;
  }

  private url(key: string): string {
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    const res = await this.signer.fetch(this.url(key), {
      method: "PUT",
      headers: { "content-type": mime },
      body: bytes,
    });
    if (!res.ok) throw new Error(`${key}: R2 PUT failed with ${res.status}`);
  }

  async getJson<T>(key: string): Promise<{ value: T; generation: string } | null> {
    // Ask for the body uncompressed: a response compressed on the way out carries a weak ETag
    // (W/"..."), and If-Match never matches a weak ETag, so every later write would fail.
    const res = await this.signer.fetch(this.url(key), {
      method: "GET",
      headers: { "accept-encoding": "identity" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${key}: R2 GET failed with ${res.status}`);
    const generation = res.headers.get("etag")?.replace(/^W\//, "");
    if (!generation) throw new Error(`${key}: R2 returned no ETag`);
    return { value: JSON.parse(await res.text()) as T, generation };
  }

  async putJson(key: string, value: unknown, ifGeneration: string): Promise<string> {
    const condition: Record<string, string> =
      ifGeneration === "0" ? { "if-none-match": "*" } : { "if-match": ifGeneration };
    const res = await this.signer.fetch(this.url(key), {
      method: "PUT",
      headers: { "content-type": "application/json", ...condition },
      body: JSON.stringify(value),
    });
    // 412 is a failed condition; R2 answers 409 when another conditional write to the key is
    // in flight. Both mean another writer got there first.
    if (res.status === 412 || res.status === 409) {
      throw new PreconditionFailed(
        `${key}: R2 answered ${res.status}, ETag is not ${ifGeneration}`,
      );
    }
    if (!res.ok) throw new Error(`${key}: R2 PUT failed with ${res.status}`);
    const generation = res.headers.get("etag");
    if (!generation) throw new Error(`${key}: R2 returned no ETag`);
    return generation;
  }

  async readUrl(key: string, ttlSec: number): Promise<string> {
    const url = new URL(this.url(key));
    url.searchParams.set("X-Amz-Expires", String(ttlSec));
    const signed = await this.signer.sign(url.toString(), {
      method: "GET",
      aws: { signQuery: true },
    });
    return signed.url;
  }
}
