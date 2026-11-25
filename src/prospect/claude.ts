import type Anthropic from "@anthropic-ai/sdk";
import type { LinePicker, PickInput, PickResult, Stage } from "../types/index.ts";
import { PickerError } from "../types/index.ts";
import { generatorUserMessage } from "./prompt.ts";

interface ContentBlock {
  type: string;
  text?: string;
}
interface GeneratorResponse {
  stop_reason: string | null;
  content: ContentBlock[];
}
interface RequestOptions {
  timeout: number;
  maxRetries: number;
}

/**
 * The slice of the Anthropic SDK client the generator uses. Declared here so tests stub it
 * without the SDK; the real client satisfies it structurally.
 */
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Effort = NonNullable<NonNullable<CreateParams["output_config"]>["effort"]>;

export interface GeneratorClient {
  beta: {
    messages: {
      create(params: CreateParams, options: RequestOptions): Promise<GeneratorResponse>;
    };
  };
}

const GENERATE_TIMEOUT_MS = 12000;

function isTimeout(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur instanceof Error; depth++) {
    if (
      cur.name === "APIConnectionTimeoutError" ||
      cur.name === "TimeoutError" ||
      cur.name === "AbortError"
    ) {
      return true;
    }
    cur = cur.cause;
  }
  return false;
}

/** Generates the prospect's reply in its own words, instead of picking a script line. */
export class ClaudeGenerator implements LinePicker {
  readonly #client: GeneratorClient;
  readonly #model: string;
  readonly #effort: string;
  readonly #systemPrompt: string;

  constructor(client: GeneratorClient, model: string, effort: string, systemPrompt: string) {
    this.#client = client;
    this.#model = model;
    this.#effort = effort;
    this.#systemPrompt = systemPrompt;
  }

  async pick(input: PickInput): Promise<PickResult> {
    let response: GeneratorResponse;
    try {
      response = await this.#client.beta.messages.create(
        {
          model: this.#model,
          max_tokens: 512,
          system: [
            { type: "text", text: this.#systemPrompt, cache_control: { type: "ephemeral" } },
          ],
          messages: [
            {
              role: "user",
              content: generatorUserMessage({
                stage: input.stage,
                recentTurns: input.recentTurns,
                candidateText: input.candidateText,
                allowedNextStages: input.allowedNextStages,
              }),
            },
          ],
          output_config: {
            effort: this.#effort as Effort,
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  text: { type: "string", minLength: 1, maxLength: 200 },
                  nextStage: { type: "string", enum: input.allowedNextStages },
                  endReason: { type: "string", enum: ["booked", "prospect_ended"] },
                },
                required: ["text", "nextStage"],
                additionalProperties: false,
              },
            },
          },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: GENERATE_TIMEOUT_MS, maxRetries: 0 },
      );
    } catch (err) {
      throw new PickerError(isTimeout(err) ? "picker_timeout" : "picker_error");
    }

    if (response.stop_reason === "refusal") throw new PickerError("picker_refusal");

    const block = response.content.find((b) => b.type === "text");
    if (block === undefined || typeof block.text !== "string") {
      throw new PickerError("picker_error");
    }
    let parsed: { text?: unknown; nextStage?: unknown; endReason?: unknown } | null;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      throw new PickerError("picker_error");
    }
    const text = parsed?.text;
    const nextStage = parsed?.nextStage;
    const endReason = parsed?.endReason;
    if (typeof text !== "string" || text.trim() === "") throw new PickerError("picker_error");
    if (typeof nextStage !== "string") throw new PickerError("picker_error");
    if (endReason !== undefined && endReason !== "booked" && endReason !== "prospect_ended") {
      throw new PickerError("picker_error");
    }
    return {
      text: text.trim(),
      nextStage: nextStage as Stage,
      endReason: endReason === "booked" || endReason === "prospect_ended" ? endReason : undefined,
    };
  }
}
