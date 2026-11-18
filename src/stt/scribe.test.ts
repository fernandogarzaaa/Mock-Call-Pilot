import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscribeError } from "../types/index.ts";
import { ScribeTranscriber } from "./scribe.ts";

const audio = new Uint8Array([1, 2, 3, 250, 251]);

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ScribeTranscriber", () => {
  it("posts the audio and model to Scribe with the api key and returns trimmed text", async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      okResponse({ text: "  hello there \n" }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const text = await new ScribeTranscriber("key-123", "scribe_v1").transcribe(
      audio,
      "audio/webm",
    );

    expect(text).toBe("hello there");
    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("xi-api-key")).toBe("key-123");
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v1");
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/webm");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);
  });

  it("sends a 10 second abort signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ text: "x" })),
    );
    await new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm");
    expect(timeoutSpy).toHaveBeenCalledWith(10000);
  });

  it("returns an empty string when Scribe hears nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ text: "   " })),
    );
    expect(await new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm")).toBe("");
  });

  it("throws stt_error on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"text":"ignored"}', { status: 500 })),
    );
    await expect(
      new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm"),
    ).rejects.toMatchObject({ kind: "stt_error" });
  });

  it("throws stt_error when the body has no text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ language_code: "en" })),
    );
    const err = await new ScribeTranscriber("k", "m")
      .transcribe(audio, "audio/webm")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscribeError);
    expect((err as TranscribeError).kind).toBe("stt_error");
  });

  it("throws stt_error when text is not a string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ text: 42 })),
    );
    await expect(
      new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm"),
    ).rejects.toMatchObject({ kind: "stt_error" });
  });

  it("throws stt_error when the body is not JSON or is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200 })),
    );
    await expect(
      new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm"),
    ).rejects.toMatchObject({ kind: "stt_error" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(null)),
    );
    await expect(
      new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm"),
    ).rejects.toMatchObject({ kind: "stt_error" });
  });

  it("throws stt_error when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(
      new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm"),
    ).rejects.toMatchObject({ kind: "stt_error" });
  });

  it("throws stt_timeout when the request is aborted by the timeout signal", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );

    const pending = new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm");
    controller.abort(new DOMException("timed out", "TimeoutError"));

    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscribeError);
    expect((err as TranscribeError).kind).toBe("stt_timeout");
  });

  it("throws stt_timeout when the timeout hits while reading the body", async () => {
    const res = new Response("{}", { status: 200 });
    vi.spyOn(res, "json").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );
    await expect(
      new ScribeTranscriber("k", "m").transcribe(audio, "audio/webm"),
    ).rejects.toMatchObject({ kind: "stt_timeout" });
  });
});
