import type { LinePicker, PickInput, ScriptConfig } from "../types/index.ts";
import { PickerError } from "../types/index.ts";

/** Rule-based picker for demo and fake-vendor runs. It reads what the candidate just said
 *  and picks the line or objection that answers it, so the prospect responds like in a real
 *  call instead of marching through a fixed sequence. Deterministic: the same candidate text
 *  in the same stage always picks the same line. When nothing matches, it falls back to
 *  advancing toward `booked`, so the call always progresses. */
export class FakePicker implements LinePicker {
  readonly #script: ScriptConfig;

  constructor(script: ScriptConfig) {
    this.#script = script;
  }

  async pick(input: PickInput): Promise<{ lineId: string }> {
    const allowed = new Set(input.allowed.map((a) => a.id));
    for (const id of this.#rulesFor(input)) {
      if (allowed.has(id)) return { lineId: id };
    }
    const candidates = input.allowed.flatMap((option) => {
      const line = this.#script.lines.find((l) => l.id === option.id);
      return line === undefined ? [] : [line];
    });
    const chosen =
      input.stage === "d4_schedule"
        ? candidates.find((l) => l.endsCall === "booked")
        : candidates.find((l) => l.endsCall === undefined && l.nextStage !== input.stage);
    if (chosen === undefined) throw new PickerError("picker_error");
    return { lineId: chosen.id };
  }

  /** Ordered line or objection ids that answer the candidate's words in this stage.
   *  The first id that is allowed wins. Empty means no rule matched. */
  #rulesFor(input: PickInput): string[] {
    const text = input.candidateText.toLowerCase();
    const firstTurn = input.recentTurns.length === 0;
    switch (input.stage) {
      case "d1_attention": {
        if (/is this john/i.test(text)) return ["d1.speaking"];
        if (/^\W*(hi|hey|hello)?\W*john\W*\??\W*$/.test(text)) return ["d1.whos"];
        if (/30 second|quick|a moment|just a minute/i.test(text)) return ["d1.goahead"];
        if (/can-am|telematics|my name is|this is .* from|i'?m calling/i.test(text)) {
          return ["obj.busy", "d1.goahead"];
        }
        if (firstTurn) return ["d1.hello"];
        return [];
      }
      case "d2_lawsuit": {
        if (/gps|telematics|tracking|features|product/i.test(text)) return ["d2.listen"];
        if (/truck|fleet|vehicles|how many/i.test(text)) return ["fc.count"];
        return [];
      }
      case "fleet_check": {
        // Unreachable: fc.count now lives in d2_lawsuit, so the call never enters
        // fleet_check. Kept so the stage still has a defined rule set.
        return [];
      }
      case "d3_pitch": {
        if (/i'?ll (send|email)|sure.*(send|email)|i can (send|email)/i.test(text)) {
          return ["d3.consider"];
        }
        if (/not interested|no thanks|i'?ll pass/i.test(text)) return ["d3.hangup"];
        if (
          /meet|meeting|assessment|twenty minutes|20 minutes|schedule|book|calendar/i.test(text)
        ) {
          return ["obj.sendinfo", "obj.thinkaboutit", "d3.agree"];
        }
        return [];
      }
      case "d4_schedule": {
        if (/email/i.test(text)) return ["d4.email"];
        if (/what.*about|what.*for|remind me/i.test(text)) return ["d4.about"];
        if (/thursday|december 3/i.test(text)) return ["d4.thursday"];
        return [];
      }
    }
  }
}
