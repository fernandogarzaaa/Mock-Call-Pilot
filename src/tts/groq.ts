import type { Synthesizer, VoiceChoice } from "../types/index.ts";
import { SynthesizeError } from "../types/index.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/speech";
const TIMEOUT_MS = 10_000;
/** Orpheus caps one request at 200 characters. Longer text is never truncated: the page falls back to text only instead of speaking a cut-off line. */
export const MAX_TTS_CHARS = 200;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** Orpheus on Groq, through its OpenAI-compatible speech endpoint. WAV only. */
export class GroqSynthesizer implements Synthesizer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maleVoice: string;
  private readonly femaleVoice: string;

  constructor(apiKey: string, model: string, maleVoice: string, femaleVoice = "autumn") {
    this.apiKey = apiKey;
    this.model = model;
    this.maleVoice = maleVoice;
    this.femaleVoice = femaleVoice;
  }

  async synthesize(
    text: string,
    voice: VoiceChoice = "male",
  ): Promise<{ audio: Uint8Array; mime: string }> {
    if (text.trim() === "") throw new SynthesizeError("tts_error", "empty text");
    if (text.length > MAX_TTS_CHARS) {
      throw new SynthesizeError(
        "tts_error",
        `text is ${text.length} characters, over the ${MAX_TTS_CHARS} limit`,
      );
    }
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: voice === "female" ? this.femaleVoice : this.maleVoice,
          response_format: "wav",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : "request failed";
      throw new SynthesizeError(isTimeout(err) ? "tts_timeout" : "tts_error", detail);
    }
    // Includes 429, the free tier's rate limit: the page falls back to text only.
    if (!res.ok) {
      const reason = (await res.text().catch(() => "")).slice(0, 300);
      throw new SynthesizeError("tts_error", `Groq answered ${res.status}: ${reason}`);
    }
    // The body read is covered by the same abort signal, so it can time out too.
    let audio: Uint8Array;
    try {
      audio = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      throw new SynthesizeError(isTimeout(err) ? "tts_timeout" : "tts_error");
    }
    if (audio.byteLength === 0) throw new SynthesizeError("tts_error", "empty audio");
    return { audio, mime: "audio/wav" };
  }
}
