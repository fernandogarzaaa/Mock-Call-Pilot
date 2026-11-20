import { describe, expect, it } from "vitest";
import { FakeTranscriber } from "./fake.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("FakeTranscriber", () => {
  const fake = new FakeTranscriber();

  it("returns short UTF-8 audio as trimmed text", async () => {
    expect(await fake.transcribe(enc("  we run forty trucks \n"), "audio/webm")).toBe(
      "we run forty trucks",
    );
  });

  it("decodes multi-byte UTF-8 markers", async () => {
    expect(await fake.transcribe(enc("café ✓"), "audio/webm")).toBe("café ✓");
  });

  it("returns the fixed string for binary audio", async () => {
    const binary = new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28]);
    expect(await fake.transcribe(binary, "audio/webm")).toBe("(fake transcript)");
  });

  it("returns the fixed string for valid UTF-8 at 200 bytes or more", async () => {
    expect(await fake.transcribe(enc("a".repeat(200)), "audio/webm")).toBe("(fake transcript)");
    expect(await fake.transcribe(enc("a".repeat(500)), "audio/webm")).toBe("(fake transcript)");
  });

  it("still decodes at 199 bytes", async () => {
    const marker = "b".repeat(199);
    expect(await fake.transcribe(enc(marker), "audio/webm")).toBe(marker);
  });

  it("returns an empty string for empty audio", async () => {
    expect(await fake.transcribe(new Uint8Array(0), "audio/webm")).toBe("");
  });
});
