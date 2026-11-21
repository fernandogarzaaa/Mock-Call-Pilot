import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscribeError } from "../types/index.ts";
import { GroqTranscriber, groqFileName } from "./groq.ts";

const audio = new Uint8Array([1, 2, 3, 250, 251]);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const make = () => new GroqTranscriber("gsk-test", "whisper-large-v3-turbo");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function kindOf(run: Promise<string>): Promise<string> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(TranscribeError);
    return (error as TranscribeError).kind;
  }
  throw new Error("expected a TranscribeError");
}

describe("groqFileName", () => {
  it("gives the upload the extension that matches the recording type", () => {
    expect(groqFileName("audio/mp4")).toBe("audio.mp4");
    expect(groqFileName("audio/webm;codecs=opus")).toBe("audio.webm");
    expect(groqFileName(" Audio/OGG ; codecs=opus")).toBe("audio.ogg");
    expect(groqFileName("audio/mpeg")).toBe("audio.mp3");
    expect(groqFileName("audio/wav")).toBe("audio.wav");
  });
  it("falls back to webm for a type it does not know", () => {
    expect(groqFileName("")).toBe("audio.webm");
    expect(groqFileName("text/plain")).toBe("audio.webm");
  });
});

describe("GroqTranscriber", () => {
  it("posts the audio to Groq as English with the key and returns trimmed text", async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      ok({ text: "  this is Sam with Can-Am \n" }),
    );
    vi.stubGlobal("fetch", fetchStub);

    expect(await make().transcribe(audio, "audio/mp4")).toBe("this is Sam with Can-Am");

    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer gsk-test");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("en");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("temperature")).toBe("0");
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.mp4");
    expect(file.type).toBe("audio/mp4");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);
  });

  it("sends a 10 second abort signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      ok({ text: "x" }),
    );
    vi.stubGlobal("fetch", fetchStub);
    await make().transcribe(audio, "audio/webm");
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    const init = fetchStub.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it("reports a timeout as stt_timeout, from the request or from reading the body", async () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      const timeout = Object.assign(new Error("slow"), { name });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw timeout;
        }),
      );
      expect(await kindOf(make().transcribe(audio, "audio/webm"))).toBe("stt_timeout");
      const slowBody = new Response("{}", { status: 200 });
      vi.spyOn(slowBody, "json").mockRejectedValue(timeout);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => slowBody),
      );
      expect(await kindOf(make().transcribe(audio, "audio/webm"))).toBe("stt_timeout");
    }
  });

  it("reports a network failure, a rate limit and any other bad status as stt_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    expect(await kindOf(make().transcribe(audio, "audio/webm"))).toBe("stt_error");
    for (const status of [400, 401, 429, 500]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status })),
      );
      expect(await kindOf(make().transcribe(audio, "audio/webm"))).toBe("stt_error");
    }
  });

  it("keeps the status and reason Groq gave, for the server log", async () => {
    const body = JSON.stringify({ error: { message: "Invalid API Key" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 401 })),
    );
    const error = await make()
      .transcribe(audio, "audio/webm")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TranscribeError);
    expect((error as TranscribeError).detail).toBe(`Groq answered 401: ${body}`);
    expect((error as TranscribeError).detail).not.toContain("gsk-test");
  });

  it("reports a body that is not JSON or has no text as stt_error", async () => {
    for (const body of ["not json", "null", "{}", '{"text":7}']) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status: 200 })),
      );
      expect(await kindOf(make().transcribe(audio, "audio/webm"))).toBe("stt_error");
    }
  });

  it("returns an empty string when Groq heard nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ text: "   " })),
    );
    expect(await make().transcribe(audio, "audio/webm")).toBe("");
  });
});
