# Mutation brief: script

Each entry is a code change that no current test detects. Write or tighten a test that asserts
behaviour a caller can observe and fails under that change. If a mutant cannot change observable
behaviour (an equivalent mutant, or text only seen in a log), do not test it: list it under
'## Equivalent' at the end of this file with a one-line reason. Do not change production behaviour
except to fix a real bug a new test exposes; describe any such fix under '## Bugs fixed'.

- `src/script/machine.ts:34` in `applyLine`, survived: StringLiteral: ``line "${lineId}" is not allowed in s...` -> ````
- `src/script/machine.ts:50` in `applyLine`, survived: ConditionalExpression: `!objection` -> `false`
- `src/script/machine.ts:50` in `applyLine`, no_coverage: BlockStatement: `{ throw new Error(`line "${lineId}" i...` -> `{}`
- `src/script/machine.ts:51` in `applyLine`, no_coverage: StringLiteral: ``line "${lineId}" is not in the script`` -> ````
- `src/script/machine.ts:101` in `finish`, survived: OptionalChaining: `next.turns[next.turns.length - 1]?.pr...` -> `next.turns[next.turns.length - 1].pro...`
- `src/script/machine.ts:101` in `finish`, no_coverage: StringLiteral: `""` -> `"Stryker was here!"`
- `src/script/machine.ts:122` in `<module>`, survived: OptionalChaining: `script.objections.find((objection) =>...` -> `script.objections.find(objection => o...`
- `src/script/machine.ts:123` in `<module>`, no_coverage: StringLiteral: `""` -> `"Stryker was here!"`
- `src/script/machine.ts:140` in `<module>`, survived: ConditionalExpression: `typeof pickedId === "string"` -> `true`
