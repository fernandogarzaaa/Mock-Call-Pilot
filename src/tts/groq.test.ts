import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthesizeError } from "../types/index.ts";
import { GroqSynthesizer, MAX_TTS_CHARS } from "./groq.ts";

const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
const ok = (body: Uint8Array) => new Response(body, { status: 200 });
const make = () =>
  new GroqSynthesizer("gsk-test", "canopylabs/orpheus-v1-english", "austin", "autumn");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function kindOf(run: Promise<{ audio: Uint8Array; mime: string }>): Promise<string> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(SynthesizeError);
    return (error as SynthesizeError).kind;
  }
  throw new Error("expected a SynthesizeError");
}

describe("GroqSynthesizer", () => {
  it("posts the text to the speech endpoint and returns WAV audio", async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(wav));
    vi.stubGlobal("fetch", fetchStub);

    const result = await make().synthesize("Hello?");
    expect(result.mime).toBe("audio/wav");
    expect(result.audio).toEqual(wav);

    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/speech");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer gsk-test");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: "canopylabs/orpheus-v1-english",
      input: "Hello?",
      voice: "austin",
      response_format: "wav",
    });
  });

  it("sends the male voice by default and the female voice when asked", async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(wav));
    vi.stubGlobal("fetch", fetchStub);
    const bodyOf = (call: number) =>
      JSON.parse(fetchStub.mock.calls[call]?.[1]?.body as string) as Record<string, unknown>;

    await make().synthesize("Hello?");
    expect(bodyOf(0).voice).toBe("austin");
    await make().synthesize("Hello?", "male");
    expect(bodyOf(1).voice).toBe("austin");
    await make().synthesize("Hello?", "female");
    expect(bodyOf(2).voice).toBe("autumn");
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it("sends a 10 second abort signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(wav));
    vi.stubGlobal("fetch", fetchStub);
    await make().synthesize("Hello?");
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    const init = fetchStub.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it("reports a timeout as tts_timeout, from the request or from reading the body", async () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      const timeout = Object.assign(new Error("slow"), { name });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw timeout;
        }),
      );
      expect(await kindOf(make().synthesize("Hello?"))).toBe("tts_timeout");
      const slowBody = new Response(wav, { status: 200 });
      vi.spyOn(slowBody, "arrayBuffer").mockRejectedValue(timeout);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => slowBody),
      );
      expect(await kindOf(make().synthesize("Hello?"))).toBe("tts_timeout");
    }
  });

  it("reports a network failure, a rate limit and any other bad status as tts_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    expect(await kindOf(make().synthesize("Hello?"))).toBe("tts_error");
    for (const status of [400, 401, 429, 500]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status })),
      );
      expect(await kindOf(make().synthesize("Hello?"))).toBe("tts_error");
    }
  });

  it("keeps the status and reason Groq gave, for the server log", async () => {
    const body = JSON.stringify({ error: { message: "Invalid API Key" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 401 })),
    );
    const error = await make()
      .synthesize("Hello?")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SynthesizeError);
    expect((error as SynthesizeError).detail).toBe(`Groq answered 401: ${body}`);
    expect((error as SynthesizeError).detail).not.toContain("gsk-test");
  });

  it("refuses empty text and text over the 200 character limit without calling Groq", async () => {
    const fetchStub = vi.fn(async () => ok(wav));
    vi.stubGlobal("fetch", fetchStub);
    expect(await kindOf(make().synthesize("   "))).toBe("tts_error");
    expect(await kindOf(make().synthesize("x".repeat(MAX_TTS_CHARS + 1)))).toBe("tts_error");
    expect(fetchStub).not.toHaveBeenCalled();
    // A line exactly at the limit goes through.
    const result = await make().synthesize("x".repeat(MAX_TTS_CHARS));
    expect(result.audio).toEqual(wav);
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it("reports empty audio as tts_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(new Uint8Array(0))),
    );
    expect(await kindOf(make().synthesize("Hello?"))).toBe("tts_error");
  });
});
