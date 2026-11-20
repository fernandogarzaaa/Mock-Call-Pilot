import { describe, expect, it, vi } from "vitest";
import {
  callControls,
  callPhase,
  formatRemaining,
  LOST_MESSAGE,
  MAX_UPLOAD_BYTES,
  NOT_SAVED_MESSAGE,
  nextScreen,
  onTurnError,
  pickMimeType,
  postWithRetry,
  recordingExtension,
  STEPS,
  stepFor,
  TYPED_TURN_MAX_BYTES,
  tooLargeToUpload,
  typedTurnBytes,
  validName,
} from "./call-core.js";

describe("pickMimeType", () => {
  const all = () => true;
  it("prefers MP4 over WebM and Ogg", () => {
    expect(pickMimeType(all)).toBe("audio/mp4");
  });
  it("falls back to WebM, then Ogg, in that order", () => {
    expect(pickMimeType((t) => t !== "audio/mp4")).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/ogg;codecs=opus")).toBe("audio/ogg;codecs=opus");
  });
  it("returns null when nothing is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
  it("asks about each type by its exact string", () => {
    const asked = [];
    pickMimeType((t) => {
      asked.push(t);
      return false;
    });
    expect(asked).toEqual(["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"]);
  });
});

describe("recordingExtension", () => {
  it("maps each recorded type, ignoring parameters and case", () => {
    expect(recordingExtension("audio/mp4;codecs=opus")).toBe("mp4");
    expect(recordingExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(recordingExtension("Audio/Ogg")).toBe("ogg");
  });
  it("uses bin for anything else", () => {
    expect(recordingExtension("")).toBe("bin");
    expect(recordingExtension("audio/wav")).toBe("bin");
  });
});

describe("validName", () => {
  it("accepts 1 to 80 characters after trimming", () => {
    expect(validName("A")).toBe(true);
    expect(validName("  Ana  ")).toBe(true);
    expect(validName("x".repeat(80))).toBe(true);
  });
  it("rejects empty, blank, too long and non-string names", () => {
    expect(validName("")).toBe(false);
    expect(validName("   ")).toBe(false);
    expect(validName("x".repeat(81))).toBe(false);
    expect(validName(null)).toBe(false);
    expect(validName(undefined)).toBe(false);
  });
  it("counts characters, not UTF-16 units", () => {
    expect(validName("😀".repeat(80))).toBe(true);
    expect(validName("😀".repeat(81))).toBe(false);
  });
});

describe("tooLargeToUpload", () => {
  it("allows exactly 25 MB and rejects one byte more", () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(tooLargeToUpload(MAX_UPLOAD_BYTES)).toBe(false);
    expect(tooLargeToUpload(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });
});

describe("callControls", () => {
  it("offers Redo on a practice call", () => {
    expect(callControls("practice")).toEqual(["speak", "done", "redo", "end"]);
  });
  it("gives the final call no Redo", () => {
    expect(callControls("call")).toEqual(["speak", "done", "end"]);
    expect(callControls("call")).not.toContain("redo");
  });
  it("has no call buttons off the call screens", () => {
    for (const screen of ["ready", "confirm", "uploading", "done"]) {
      expect(callControls(screen)).toEqual([]);
    }
  });
});

describe("nextScreen", () => {
  const ok = { type: "submit", name: "Ana" };
  it("walks name, brief, mic, ready, confirm, call, uploading, done", () => {
    let screen = "name";
    const events = [
      ok,
      { type: "accept", noticeTicked: true },
      { type: "granted" },
      { type: "final", hasMic: true },
      { type: "start", confirmed: true },
      { type: "end" },
      { type: "uploaded" },
    ];
    const seen = [screen];
    for (const event of events) {
      screen = nextScreen(screen, event);
      seen.push(screen);
    }
    expect(seen).toEqual(["name", "brief", "mic", "ready", "confirm", "call", "uploading", "done"]);
  });
  it("runs any number of practice calls from ready and comes back each time", () => {
    let screen = "ready";
    for (let i = 0; i < 3; i++) {
      screen = nextScreen(screen, { type: "practice" });
      expect(screen).toBe("practice");
      screen = nextScreen(screen, { type: "end" });
      expect(screen).toBe("ready");
    }
  });
  it("never reaches upload or the link from a practice call", () => {
    for (const type of ["start", "uploaded", "failed", "retry", "final", "redo"]) {
      expect(nextScreen("practice", { type, confirmed: true })).toBe("practice");
    }
    expect(nextScreen("practice", { type: "end" })).not.toBe("uploading");
  });
  it("blocks the final call until the candidate confirms", () => {
    expect(nextScreen("ready", { type: "start" })).toBe("ready");
    expect(nextScreen("ready", { type: "start", confirmed: true })).toBe("ready");
    expect(nextScreen("ready", { type: "final", hasMic: true })).toBe("confirm");
    expect(nextScreen("confirm", { type: "start" })).toBe("confirm");
    expect(nextScreen("confirm", { type: "start", confirmed: false })).toBe("confirm");
    expect(nextScreen("confirm", { type: "start", confirmed: "yes" })).toBe("confirm");
    expect(nextScreen("confirm", { type: "start", confirmed: true })).toBe("call");
    expect(nextScreen("confirm", { type: "back" })).toBe("ready");
  });
  it("gives the final call no way back to practice or ready", () => {
    for (const type of ["practice", "back", "redo", "start", "final"]) {
      expect(nextScreen("call", { type, confirmed: true })).toBe("call");
    }
    expect(nextScreen("done", { type: "practice" })).toBe("done");
  });
  it("needs a valid name to leave the name screen", () => {
    expect(nextScreen("name", { type: "submit", name: "  " })).toBe("name");
    expect(nextScreen("name", { type: "submit" })).toBe("name");
    expect(nextScreen("name", { type: "submit", name: "x".repeat(81) })).toBe("name");
  });
  it("needs the notice tick to leave the brief", () => {
    expect(nextScreen("brief", { type: "accept", noticeTicked: false })).toBe("brief");
    expect(nextScreen("brief", { type: "accept" })).toBe("brief");
    expect(nextScreen("brief", { type: "accept", noticeTicked: "yes" })).toBe("brief");
    expect(nextScreen("brief", { type: "accept", noticeTicked: true })).toBe("mic");
  });
  it("sends a failed upload to retry and a retry back to uploading", () => {
    expect(nextScreen("uploading", { type: "failed" })).toBe("retry");
    expect(nextScreen("retry", { type: "retry" })).toBe("uploading");
    expect(nextScreen("retry", { type: "uploaded" })).toBe("retry");
  });
  it("leaves the screen alone for events that do not apply", () => {
    expect(nextScreen("mic", { type: "start" })).toBe("mic");
    expect(nextScreen("ready", { type: "end" })).toBe("ready");
    expect(nextScreen("call", { type: "uploaded" })).toBe("call");
    expect(nextScreen("done", { type: "retry" })).toBe("done");
    expect(nextScreen("done", { type: "end" })).toBe("done");
  });
  it("ignores unknown screens, unknown events and missing events", () => {
    expect(nextScreen("nowhere", ok)).toBe("nowhere");
    expect(nextScreen("name", { type: "nope" })).toBe("name");
    expect(nextScreen("name", undefined)).toBe("name");
    expect(nextScreen("name", { type: "constructor", name: "Ana" })).toBe("name");
    expect(nextScreen("toString", ok)).toBe("toString");
  });
});

describe("postWithRetry", () => {
  const respond = (status) => ({ status, ok: status >= 200 && status < 300 });
  const form = { marker: "form" };
  const noSleep = () => {
    const waits = [];
    return { waits, sleep: async (ms) => void waits.push(ms) };
  };

  it("returns the first answer when it is not a 5xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(respond(200));
    const { waits, sleep } = noSleep();
    const response = await postWithRetry(fetchFn, "/x", form, 3, sleep);
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/x", { method: "POST", body: form });
    expect(waits).toEqual([]);
  });

  it("retries a 503 after 1 s and succeeds", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));
    const { waits, sleep } = noSleep();
    const response = await postWithRetry(fetchFn, "/x", form, 3, sleep);
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1000]);
  });

  it("retries network errors, waiting 1 s then 2 s", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(respond(200));
    const { waits, sleep } = noSleep();
    const response = await postWithRetry(fetchFn, "/x", form, 3, sleep);
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("returns the last 5xx after the final attempt, without a trailing wait", async () => {
    const fetchFn = vi.fn().mockResolvedValue(respond(502));
    const { waits, sleep } = noSleep();
    const response = await postWithRetry(fetchFn, "/x", form, 3, sleep);
    expect(response.status).toBe(502);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("throws the last network error after the final attempt", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { waits, sleep } = noSleep();
    await expect(postWithRetry(fetchFn, "/x", form, 3, sleep)).rejects.toThrow("offline");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("honours the attempts argument", async () => {
    const fetchFn = vi.fn().mockResolvedValue(respond(500));
    const { waits, sleep } = noSleep();
    await postWithRetry(fetchFn, "/x", form, 1, sleep);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("defaults to 3 attempts", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn().mockResolvedValue(respond(500));
      const pending = postWithRetry(fetchFn, "/x", form);
      await vi.runAllTimersAsync();
      expect((await pending).status).toBe(500);
      expect(fetchFn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([400, 409, 413, 422, 499])("does not retry a %i", async (status) => {
    const fetchFn = vi.fn().mockResolvedValue(respond(status));
    const { waits, sleep } = noSleep();
    const response = await postWithRetry(fetchFn, "/x", form, 3, sleep);
    expect(response.status).toBe(status);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it.each([500, 599])("retries a %i", async (status) => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(respond(status))
      .mockResolvedValueOnce(respond(200));
    const { sleep } = noSleep();
    await postWithRetry(fetchFn, "/x", form, 3, sleep);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("onTurnError", () => {
  it("goes to upload on 409 ended", () => {
    expect(onTurnError(409, { error: "ended" })).toEqual({ action: "upload" });
    expect(onTurnError(409, { error: "ended" }, true)).toEqual({ action: "upload" });
  });
  it("resends the same index once on 409 gap and 409 conflict", () => {
    expect(onTurnError(409, { error: "gap" })).toEqual({ action: "resend" });
    expect(onTurnError(409, { error: "conflict" })).toEqual({ action: "resend" });
  });
  it("says the turn was not saved when a gap or conflict happens again after the resend", () => {
    const notSaved = { action: "lost", message: NOT_SAVED_MESSAGE };
    expect(onTurnError(409, { error: "gap" }, true)).toEqual(notSaved);
    expect(onTurnError(409, { error: "conflict" }, true)).toEqual(notSaved);
  });
  it("says the turn was not saved for any other answer the server refused", () => {
    const notSaved = { action: "lost", message: NOT_SAVED_MESSAGE };
    expect(onTurnError(400, null)).toEqual(notSaved);
    expect(onTurnError(413, { error: "too_large" })).toEqual(notSaved);
    expect(onTurnError(422, { error: "bad_request" })).toEqual(notSaved);
    expect(onTurnError(409, { error: "other" })).toEqual(notSaved);
    expect(onTurnError(409, null)).toEqual(notSaved);
    expect(onTurnError(499, null)).toEqual(notSaved);
  });
  it("shows Connection lost only when the network or the server failed", () => {
    const lost = { action: "lost", message: LOST_MESSAGE };
    expect(onTurnError(0, null)).toEqual(lost);
    expect(onTurnError(399, null)).toEqual(lost);
    expect(onTurnError(503, null)).toEqual(lost);
    expect(onTurnError(200, { error: "gap" })).toEqual(lost);
    expect(onTurnError(500, { error: "ended" })).toEqual(lost);
    expect(NOT_SAVED_MESSAGE).toBe("That turn could not be saved. Press Done to try again.");
  });
  it("words the message as the design says", () => {
    expect(LOST_MESSAGE).toBe("Connection lost. Check your connection and press Done again");
  });
});

describe("formatRemaining", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatRemaining(15 * 60000)).toBe("15:00");
    expect(formatRemaining(9 * 60000 + 5000)).toBe("9:05");
    expect(formatRemaining(59000)).toBe("0:59");
    expect(formatRemaining(60000)).toBe("1:00");
    expect(formatRemaining(61000)).toBe("1:01");
  });
  it("rounds partial seconds up so 0:00 means time is up", () => {
    expect(formatRemaining(1)).toBe("0:01");
    expect(formatRemaining(1000)).toBe("0:01");
    expect(formatRemaining(1001)).toBe("0:02");
    expect(formatRemaining(0)).toBe("0:00");
  });
  it("never shows a negative time", () => {
    expect(formatRemaining(-1)).toBe("0:00");
    expect(formatRemaining(-90000)).toBe("0:00");
  });
  it("does not wrap past 99 minutes", () => {
    expect(formatRemaining(125 * 60000)).toBe("125:00");
  });
});

describe("the typed test path", () => {
  it("skips the microphone only where typed turns are allowed", () => {
    expect(nextScreen("mic", { type: "skip" })).toBe("mic");
    expect(nextScreen("mic", { type: "skip", textAllowed: false })).toBe("mic");
    expect(nextScreen("mic", { type: "skip", textAllowed: "yes" })).toBe("mic");
    expect(nextScreen("mic", { type: "skip", textAllowed: true })).toBe("ready");
  });
  it("never reaches the final call without a microphone", () => {
    expect(nextScreen("ready", { type: "final" })).toBe("ready");
    expect(nextScreen("ready", { type: "final", hasMic: false })).toBe("ready");
    expect(nextScreen("ready", { type: "final", hasMic: "yes" })).toBe("ready");
    expect(nextScreen("ready", { type: "final", hasMic: true })).toBe("confirm");
  });
  it("can go back from ready to the microphone step", () => {
    expect(nextScreen("ready", { type: "mic" })).toBe("mic");
    expect(nextScreen("practice", { type: "mic" })).toBe("practice");
    expect(nextScreen("call", { type: "mic" })).toBe("call");
  });
  it("swaps Speak and Done for Send in a typed practice call, and keeps Redo", () => {
    expect(callControls("practice", true)).toEqual(["send", "redo", "end"]);
    expect(callControls("practice", false)).toEqual(["speak", "done", "redo", "end"]);
  });
  it("gives the final call the same buttons whether or not typed is asked for", () => {
    expect(callControls("call", true)).toEqual(["speak", "done", "end"]);
  });
  it("encodes a typed turn, trimmed", () => {
    expect(new TextDecoder().decode(typedTurnBytes("  who is this  "))).toBe("who is this");
  });
  it("rejects a blank, missing or over-long typed turn", () => {
    expect(typedTurnBytes("   ")).toBeNull();
    expect(typedTurnBytes(undefined)).toBeNull();
    expect(typedTurnBytes("x".repeat(TYPED_TURN_MAX_BYTES))).not.toBeNull();
    expect(typedTurnBytes("x".repeat(TYPED_TURN_MAX_BYTES + 1))).toBeNull();
    // Counted in bytes, not characters: 100 two-byte letters are 200 bytes.
    expect(typedTurnBytes("é".repeat(100))).toBeNull();
    expect(TYPED_TURN_MAX_BYTES).toBeLessThan(200);
  });
});

describe("stepFor", () => {
  it("names five steps in order", () => {
    expect(STEPS).toEqual(["Your name", "Briefing", "Microphone", "Practice", "Final call"]);
  });
  it("places every screen on a step", () => {
    const at = (screen) => stepFor(screen).index;
    expect(["name", "brief", "mic", "ready", "practice"].map(at)).toEqual([0, 1, 2, 3, 3]);
    expect(["confirm", "call", "uploading", "retry", "done"].map(at)).toEqual([4, 4, 4, 4, 4]);
  });
  it("is finished only on the done screen", () => {
    expect(stepFor("done").finished).toBe(true);
    for (const screen of ["name", "ready", "practice", "call", "uploading", "retry"]) {
      expect(stepFor(screen).finished).toBe(false);
    }
  });
  it("puts an unknown screen on the first step", () => {
    expect(stepFor("nowhere")).toEqual({ index: 0, finished: false });
    expect(stepFor("constructor")).toEqual({ index: 0, finished: false });
  });
});

describe("callPhase", () => {
  const none = { finishing: false, busy: false, listening: false, pending: false };
  it("is idle when nothing is happening", () => {
    expect(callPhase(none)).toBe("idle");
  });
  it("is listening while a turn is being recorded", () => {
    expect(callPhase({ ...none, listening: true })).toBe("listening");
  });
  it("asks for a resend when a turn is waiting and nothing is in flight", () => {
    expect(callPhase({ ...none, pending: true })).toBe("resend");
  });
  it("is sending while a request is in flight, even with a turn waiting", () => {
    expect(callPhase({ ...none, busy: true, pending: true })).toBe("sending");
    expect(callPhase({ ...none, busy: true, listening: true })).toBe("sending");
  });
  it("is ending once the call is finishing, whatever else is true", () => {
    expect(callPhase({ finishing: true, busy: true, listening: true, pending: true })).toBe(
      "ending",
    );
  });
});
