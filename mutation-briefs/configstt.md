# Mutation brief: configstt

Each entry is a code change that no current test detects. Write or tighten a test that asserts
behaviour a caller can observe and fails under that change. If a mutant cannot change observable
behaviour (an equivalent mutant, or text only seen in a log), do not test it: list it under
'## Equivalent' at the end of this file with a one-line reason. Do not change production behaviour
except to fix a real bug a new test exposes; describe any such fix under '## Bugs fixed'.

- `src/config/load.ts:79` in `readJson`, survived: StringLiteral: `"utf8"` -> `""`
- `src/config/load.ts:80` in `readJson`, survived: BlockStatement: `{ problems.push(`${file}: ${error ins...` -> `{}`
- `src/config/load.ts:87` in `readJson`, no_coverage: StringLiteral: `"(root)"` -> `""`
- `src/config/load.ts:143` in `loadConfig`, survived: ArrayDeclaration: `[]` -> `["Stryker was here"]`
- `src/stt/scribe.ts:8` in `isTimeout`, survived: ConditionalExpression: `err.name === "AbortError"` -> `false`
- `src/stt/scribe.ts:8` in `isTimeout`, survived: StringLiteral: `"AbortError"` -> `""`
- `src/stt/scribe.ts:22` in `ScribeTranscriber.transcribe`, survived: StringLiteral: `"audio"` -> `""`
