# Mutation brief: picker

Each entry is a code change that no current test detects. Write or tighten a test that asserts
behaviour a caller can observe and fails under that change. If a mutant cannot change observable
behaviour (an equivalent mutant, or text only seen in a log), do not test it: list it under
'## Equivalent' at the end of this file with a one-line reason. Do not change production behaviour
except to fix a real bug a new test exposes; describe any such fix under '## Bugs fixed'.

- `src/picker/claude.ts:35` in `isTimeout`, survived: ConditionalExpression: `depth < 4` -> `true`
- `src/picker/claude.ts:35` in `isTimeout`, survived: EqualityOperator: `depth < 4` -> `depth <= 4`
- `src/picker/claude.ts:35` in `isTimeout`, survived: UpdateOperator: `depth++` -> `depth--`
- `src/picker/claude.ts:38` in `isTimeout`, survived: ConditionalExpression: `cur.name === "TimeoutError"` -> `false`
- `src/picker/claude.ts:38` in `isTimeout`, survived: StringLiteral: `"TimeoutError"` -> `""`
- `src/picker/claude.ts:97` in `ClaudePicker`, survived: ConditionalExpression: `block === undefined || typeof block.t...` -> `false`
- `src/picker/claude.ts:97` in `ClaudePicker`, survived: ConditionalExpression: `typeof block.text !== "string"` -> `false`
- `src/picker/claude.ts:97` in `ClaudePicker`, survived: BlockStatement: `{ throw new PickerError("picker_error...` -> `{}`
- `src/picker/claude.ts:103` in `ClaudePicker`, survived: BlockStatement: `{ throw new PickerError("picker_error...` -> `{}`
- `src/picker/fake.ts:22` in `FakePicker`, survived: ConditionalExpression: `l.endsCall === undefined` -> `true`
- `src/picker/prompt.ts:6` in `systemPrompt`, survived: MethodExpression: `[ firstName !== null ? `Your name is ...` -> `[firstName !== null ? `Your name is $...`
- `src/picker/prompt.ts:10` in `systemPrompt`, survived: ConditionalExpression: `f !== null` -> `true`
- `src/picker/prompt.ts:15` in `systemPrompt`, survived: StringLiteral: `""` -> `"Stryker was here!"`
- `src/picker/prompt.ts:16` in `systemPrompt`, survived: StringLiteral: `"Each turn you are given the call sta...` -> `""`
- `src/picker/prompt.ts:17` in `systemPrompt`, survived: StringLiteral: `""` -> `"Stryker was here!"`
- `src/picker/prompt.ts:18` in `systemPrompt`, survived: StringLiteral: `"Rules:"` -> `""`
- `src/picker/prompt.ts:23` in `systemPrompt`, survived: StringLiteral: `""` -> `"Stryker was here!"`
- `src/picker/prompt.ts:25` in `systemPrompt`, survived: StringLiteral: `"\n"` -> `""`
- `src/picker/prompt.ts:30` in `userMessage`, survived: ArrayDeclaration: `[]` -> `["Stryker was here"]`
- `src/picker/prompt.ts:39` in `userMessage`, survived: StringLiteral: `""` -> `"Stryker was here!"`
- `src/picker/prompt.ts:42` in `userMessage`, survived: StringLiteral: `""` -> `"Stryker was here!"`
- `src/picker/prompt.ts:43` in `userMessage`, survived: StringLiteral: `"Options (answer with the id in brack...` -> `""`
