import type { LinePicker, PickInput, ScriptConfig } from "../types/index.ts";
import { PickerError } from "../types/index.ts";

/** Deterministic picker for tests and fake-vendor runs: always advances toward `booked`. */
export class FakePicker implements LinePicker {
  readonly #script: ScriptConfig;

  constructor(script: ScriptConfig) {
    this.#script = script;
  }

  async pick(input: PickInput): Promise<{ lineId: string }> {
    // Objections are not in script.lines, so they never match here.
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
}
