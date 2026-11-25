import { describe, expect, it } from "vitest";
import { FakeSynthesizer } from "./fake.ts";

describe("FakeSynthesizer", () => {
  it("returns a short valid WAV of silence", async () => {
    const result = await new FakeSynthesizer().synthesize("Hello?");
    expect(result.mime).toBe("audio/wav");
    const view = new DataView(result.audio.buffer);
    const text = (offset: number, length: number) =>
      String.fromCharCode(...result.audio.slice(offset, offset + length));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(result.audio.byteLength - 44);
    // The payload is silence.
    expect(result.audio.slice(44).every((byte) => byte === 0)).toBe(true);
  });

  it("returns the same bytes for any text", async () => {
    const a = await new FakeSynthesizer().synthesize("Hello?");
    const b = await new FakeSynthesizer().synthesize("Twenty-four trucks right now.");
    expect(a.audio).toEqual(b.audio);
  });
});
