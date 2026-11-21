import type { Transcriber } from "../types/index.ts";
import { TranscribeError } from "../types/index.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const TIMEOUT_MS = 10_000;

// Groq reads the audio format from the file name, so the upload needs a real extension.
const EXTENSIONS: Record<string, string> = {
  "audio/mp4": "mp4",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export function groqFileName(mime: string): string {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return `audio.${EXTENSIONS[base] ?? "webm"}`;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** Whisper on Groq's free tier, through its OpenAI-compatible transcription endpoint. */
export class GroqTranscriber implements Transcriber {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), groqFileName(mime));
    form.append("model", this.model);
    // The script is in English; saying so keeps accented speech from being read as another language.
    form.append("language", "en");
    form.append("response_format", "json");
    form.append("temperature", "0");

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new TranscribeError(isTimeout(err) ? "stt_timeout" : "stt_error");
    }
    // Includes 429, the free tier's rate limit: the turn falls back like any other failure.
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
