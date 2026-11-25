import type { Synthesizer, VoiceChoice } from "../types/index.ts";

/** A tenth of a second of silence: 8 kHz mono 16-bit PCM, 800 samples. */
const SAMPLE_RATE = 8000;
const SAMPLES = 800;
const HEADER_BYTES = 44;
const DATA_BYTES = SAMPLES * 2;

function buildSilenceWav(): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + DATA_BYTES);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + DATA_BYTES, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, DATA_BYTES, true);
  return bytes;
}

const SILENCE_WAV = buildSilenceWav();

/** Test and demo voice: returns silence, so the page exercises playback with no vendor call. */
export class FakeSynthesizer implements Synthesizer {
  async synthesize(
    _text: string,
    _voice?: VoiceChoice,
  ): Promise<{ audio: Uint8Array; mime: string }> {
    return { audio: SILENCE_WAV, mime: "audio/wav" };
  }
}
