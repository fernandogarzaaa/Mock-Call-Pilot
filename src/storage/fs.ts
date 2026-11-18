import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PreconditionFailed, type Storage } from "../types/index.ts";

/** Keys end up in a filesystem path and in a URL, so only plain path segments are allowed. */
const KEY_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
/** A key with these endings would collide with another object's sidecar file. */
const SIDECAR_SUFFIX = /\.(?:gen|mime)$/;

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function checkKey(key: string): void {
  const dotSegment = key.split("/").some((segment) => segment === "." || segment === "..");
  if (!KEY_PATTERN.test(key) || dotSegment || SIDECAR_SUFFIX.test(key)) {
    throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
  }
}

/** NaN for anything that is not a whole number of seconds. */
function parseExpiry(exp: string | number): number {
  if (typeof exp === "number") return exp;
  return /^\d+$/.test(exp) ? Number(exp) : Number.NaN;
}

function ignore(): void {}

/** Dev and test adapter. Objects are files under `dir`; the generation lives in `<key>.gen`. */
export class FsStorage implements Storage {
  private readonly dir: string;
  private readonly signingSecret: string;
  private readonly now: () => number;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(dir: string, signingSecret: string, now: () => number = Date.now) {
    if (signingSecret === "") {
      throw new Error("FsStorage needs a non-empty signing secret");
    }
    this.dir = dir;
    this.signingSecret = signingSecret;
    this.now = now;
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    const path = this.pathFor(key);
    await this.withLock(key, async () => {
      await this.write(path, bytes, mime);
    });
  }

  async getJson<T>(key: string): Promise<{ value: T; generation: string } | null> {
    const path = this.pathFor(key);
    return this.withLock(key, async () => {
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        if (isEnoent(error)) return null;
        throw error;
      }
      return { value: JSON.parse(raw) as T, generation: await this.currentGeneration(path) };
    });
  }

  async putJson(key: string, value: unknown, ifGeneration: string): Promise<string> {
    const path = this.pathFor(key);
    return this.withLock(key, async () => {
      const current = await this.currentGeneration(path);
      if (current !== ifGeneration) {
        const message = `${key}: generation is ${current}, caller expected ${ifGeneration}`;
        throw new PreconditionFailed(message);
      }
      return this.write(path, Buffer.from(JSON.stringify(value)), "application/json");
    });
  }

  async readUrl(key: string, ttlSec: number): Promise<string> {
    checkKey(key);
    // Rounding up keeps the URL valid for at least ttlSec.
    const exp = Math.ceil(this.now() / 1000) + ttlSec;
    return `/files/${key}?exp=${exp}&sig=${this.sign(key, exp)}`;
  }

  /** For the server's `/files/*` route: true only for an unexpired URL this adapter signed. */
  verify(key: string, exp: string | number, sig: string): boolean {
    const expiry = parseExpiry(exp);
    if (!Number.isSafeInteger(expiry) || this.now() >= expiry * 1000) return false;
    const expected = Buffer.from(this.sign(key, expiry));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async read(key: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    try {
      checkKey(key);
    } catch {
      return null;
    }
    const path = this.pathFor(key);
    return this.withLock(key, async () => {
      let bytes: Uint8Array;
      try {
        bytes = await readFile(path);
      } catch (error) {
        if (isEnoent(error)) return null;
        throw error;
      }
      let mime = "application/octet-stream";
      try {
        mime = await readFile(`${path}.mime`, "utf8");
      } catch (error) {
        if (!isEnoent(error)) throw error;
      }
      return { bytes, mime };
    });
  }

  private pathFor(key: string): string {
    checkKey(key);
    return join(this.dir, ...key.split("/"));
  }

  private sign(key: string, exp: number): string {
    return createHmac("sha256", this.signingSecret).update(`${key}:${exp}`).digest("base64url");
  }

  /** "0" means the object does not exist, matching Cloud Storage's create-only precondition. */
  private async currentGeneration(path: string): Promise<string> {
    try {
      return await readFile(`${path}.gen`, "utf8");
    } catch (error) {
      if (isEnoent(error)) return "0";
      throw error;
    }
  }

  /** Callers hold the key's lock. Stores the object and bumps its generation. */
  private async write(path: string, bytes: Uint8Array, mime: string): Promise<string> {
    const next = String(Number(await this.currentGeneration(path)) + 1);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await writeFile(`${path}.mime`, mime);
    await writeFile(`${path}.gen`, next);
    return next;
  }

  /** Runs `task` after every earlier task on the same key has finished (in-process only). */
  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(ignore, ignore);
    this.locks.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
