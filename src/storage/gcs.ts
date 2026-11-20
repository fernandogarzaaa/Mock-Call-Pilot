import { PreconditionFailed, type Storage } from "../types/index.ts";

type Generation = string | number;

interface FileMetadata {
  generation?: Generation;
}

interface SaveOptions {
  resumable: boolean;
  contentType: string;
  preconditionOpts?: { ifGenerationMatch: Generation };
}

interface SignedUrlConfig {
  version: "v4";
  action: "read";
  expires: number;
}

/** The slice of `File` this adapter uses, so tests can stub it. A real `File` satisfies it. */
export interface GcsFile {
  metadata: FileMetadata;
  getMetadata(): Promise<[FileMetadata, ...unknown[]]>;
  download(): Promise<[Buffer]>;
  save(data: string | Uint8Array, options: SaveOptions): Promise<void>;
  getSignedUrl(config: SignedUrlConfig): Promise<[string, ...unknown[]]>;
}

/** The slice of `Bucket` this adapter uses. A real `Bucket` satisfies it. */
export interface GcsBucket {
  file(name: string, options?: { generation?: Generation }): GcsFile;
}

const MAX_READ_ATTEMPTS = 3;

function httpStatus(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

function generationOf(metadata: FileMetadata, key: string): string {
  if (metadata.generation === undefined) {
    throw new Error(`${key}: Cloud Storage returned no generation`);
  }
  return String(metadata.generation);
}

export class GcsStorage implements Storage {
  private readonly bucket: GcsBucket;
  private readonly now: () => number;

  constructor(bucket: GcsBucket, now: () => number = Date.now) {
    this.bucket = bucket;
    this.now = now;
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.bucket.file(key).save(bytes, { resumable: false, contentType: mime });
  }

  /**
   * Reads the metadata first and then that exact generation, so the generation returned always
   * matches the bytes returned. A stale read then fails with a 412 when written back.
   */
  async getJson<T>(key: string): Promise<{ value: T; generation: string } | null> {
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
      let generation: string;
      try {
        const [metadata] = await this.bucket.file(key).getMetadata();
        generation = generationOf(metadata, key);
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
      try {
        const [bytes] = await this.bucket.file(key, { generation }).download();
        return { value: JSON.parse(bytes.toString("utf8")) as T, generation };
      } catch (error) {
        // A 404 here means another write replaced that generation after we read its metadata.
        if (httpStatus(error) !== 404) throw error;
      }
    }
    throw new Error(`${key}: gave up after ${MAX_READ_ATTEMPTS} reads that kept changing`);
  }

  async putJson(key: string, value: unknown, ifGeneration: string): Promise<string> {
    const file = this.bucket.file(key);
    try {
      await file.save(JSON.stringify(value), {
        resumable: false,
        contentType: "application/json",
        preconditionOpts: { ifGenerationMatch: ifGeneration },
      });
    } catch (error) {
      if (httpStatus(error) === 412) {
        throw new PreconditionFailed(`${key}: generation is not ${ifGeneration}`);
      }
      throw error;
    }
    return generationOf(file.metadata, key);
  }

  async readUrl(key: string, ttlSec: number): Promise<string> {
    const config: SignedUrlConfig = {
      version: "v4",
      action: "read",
      expires: this.now() + ttlSec * 1000,
    };
    const [url] = await this.bucket.file(key).getSignedUrl(config);
    return url;
  }
}
