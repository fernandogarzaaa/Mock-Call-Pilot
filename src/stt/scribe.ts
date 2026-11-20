import type { Transcriber } from "../types/index.ts";
import { TranscribeError } from "../types/index.ts";

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const TIMEOUT_MS = 10_000;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

export class ScribeTranscriber implements Transcriber {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), "audio");
    form.append("model_id", this.model);

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new TranscribeError(isTimeout(err) ? "stt_timeout" : "stt_error");
    }
    if (!res.ok) throw new TranscribeError("stt_error");

    // The body read is covered by the same abort signal, so it can time out too.
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new TranscribeError(isTimeout(err) ? "stt_timeout" : "stt_error");
    }
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== "string") throw new TranscribeError("stt_error");
    return text.trim();
  }
}
