# Mutation brief: storage

Each entry is a code change that no current test detects. Write or tighten a test that asserts
behaviour a caller can observe and fails under that change. If a mutant cannot change observable
behaviour (an equivalent mutant, or text only seen in a log), do not test it: list it under
'## Equivalent' at the end of this file with a one-line reason. Do not change production behaviour
except to fix a real bug a new test exposes; describe any such fix under '## Bugs fixed'.

- `src/storage/fs.ts:9` in `<module>`, survived: Regex: `/\.(?:gen|mime)$/` -> `/\.(?:gen|mime)/`
- `src/storage/fs.ts:12` in `isEnoent`, survived: OptionalChaining: `(error as NodeJS.ErrnoException | nul...` -> `(error as NodeJS.ErrnoException | nul...`
- `src/storage/fs.ts:12` in `isEnoent`, survived: ConditionalExpression: `(error as NodeJS.ErrnoException | nul...` -> `true`
- `src/storage/fs.ts:18` in `checkKey`, survived: StringLiteral: ``invalid storage key: ${JSON.stringif...` -> ````
- `src/storage/fs.ts:24` in `parseExpiry`, survived: ConditionalExpression: `typeof exp === "number"` -> `false`
- `src/storage/fs.ts:24` in `parseExpiry`, survived: StringLiteral: `"number"` -> `""`
- `src/storage/fs.ts:25` in `parseExpiry`, survived: Regex: `/^\d+$/` -> `/\d+$/`
- `src/storage/fs.ts:25` in `parseExpiry`, survived: Regex: `/^\d+$/` -> `/^\d+/`
- `src/storage/fs.ts:39` in `FsStorage.constructor`, survived: StringLiteral: `"FsStorage needs a non-empty signing ...` -> `""`
- `src/storage/fs.ts:58` in `FsStorage`, survived: StringLiteral: `"utf8"` -> `""`
- `src/storage/fs.ts:60` in `FsStorage`, survived: ConditionalExpression: `isEnoent(error)` -> `true`
- `src/storage/fs.ts:72` in `FsStorage.putJson`, survived: StringLiteral: ``${key}: generation is ${current}, ca...` -> ````
- `src/storage/fs.ts:107` in `FsStorage`, survived: ConditionalExpression: `isEnoent(error)` -> `true`
- `src/storage/fs.ts:110` in `FsStorage`, survived: StringLiteral: `"application/octet-stream"` -> `""`
- `src/storage/fs.ts:113` in `FsStorage`, no_coverage: BlockStatement: `{ if (!isEnoent(error)) throw error; }` -> `{}`
- `src/storage/fs.ts:114` in `FsStorage`, no_coverage: BooleanLiteral: `!isEnoent(error)` -> `isEnoent(error)`
- `src/storage/fs.ts:114` in `FsStorage`, no_coverage: ConditionalExpression: `!isEnoent(error)` -> `true`
- `src/storage/fs.ts:114` in `FsStorage`, no_coverage: ConditionalExpression: `!isEnoent(error)` -> `false`
- `src/storage/fs.ts:122` in `FsStorage.pathFor`, survived: StringLiteral: `"/"` -> `""`
- `src/storage/fs.ts:134` in `FsStorage.currentGeneration`, survived: ConditionalExpression: `isEnoent(error)` -> `true`
- `src/storage/fs.ts:141` in `FsStorage.write`, survived: ArithmeticOperator: `Number(await this.currentGeneration(p...` -> `Number(await this.currentGeneration(p...`
- `src/storage/fs.ts:157` in `FsStorage.withLock`, survived: BlockStatement: `{ if (this.locks.get(key) === tail) t...` -> `{}`
- `src/storage/fs.ts:158` in `FsStorage.withLock`, survived: ConditionalExpression: `this.locks.get(key) === tail` -> `true`
- `src/storage/fs.ts:158` in `FsStorage.withLock`, survived: ConditionalExpression: `this.locks.get(key) === tail` -> `false`
- `src/storage/fs.ts:158` in `FsStorage.withLock`, survived: EqualityOperator: `this.locks.get(key) === tail` -> `this.locks.get(key) !== tail`
- `src/storage/fs.ts:158` in `FsStorage.withLock`, survived: CallExpression: `this.locks.delete(key);` -> `;`
- `src/storage/gcs.ts:38` in `httpStatus`, survived: OptionalChaining: `(error as { code?: unknown } | null)?...` -> `(error as { code?: unknown; } | null)...`
- `src/storage/gcs.ts:39` in `httpStatus`, survived: ConditionalExpression: `typeof code === "number"` -> `true`
- `src/storage/gcs.ts:97` in `GcsStorage.putJson`, survived: StringLiteral: ``${key}: generation is not ${ifGenera...` -> ````
