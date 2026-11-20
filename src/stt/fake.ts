import type { Transcriber } from "../types/index.ts";

const MAX_MARKER_BYTES = 200;
export const FAKE_TRANSCRIPT = "(fake transcript)";

export class FakeTranscriber implements Transcriber {
  async transcribe(audio: Uint8Array, _mime: string): Promise<string> {
    if (audio.byteLength < MAX_MARKER_BYTES) {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(audio).trim();
      } catch {
        // Not valid UTF-8: treat as real browser audio.
      }
    }
    return FAKE_TRANSCRIPT;
  }
}
