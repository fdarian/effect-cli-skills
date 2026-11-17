Library that gives Effect v4 Bun CLIs a read-only `skills` command (`<cli> skills list | get | stub`) backed by skills embedded in the binary. Consumed through a pnpm git ref (`github:fdarian/effect-cli-skills#vX.Y.Z`); no build step, the TS source in `src/` is what ships. See [README.md](./README.md) for the user-facing shape.

## Stack

pnpm, Bun (runtime and `bun test`), Effect v4 (`effect/cli`, `Context.Service`, `Schema.TaggedError`), Biome (tabs, single quotes), `tsc --noEmit`.

## Layout

- `src/index.ts`: public entry (`skills`, `SkillSource`, errors)
- `src/embed.ts`: `embedSkills(dir)`, exported as `effect-cli-skills/embed`. Must not import `effect` (it runs inside a Bun macro at build time) and returns base64 strings because macros cannot return a `Uint8Array`.
- `src/skill-source.ts`: the `SkillSource` service. Commands depend only on it; `SkillSource.inline(record)` is the one adapter.
- `src/commands.ts`: the command tree. All output goes through `Stdio` (not `Console`) so `--file` writes raw bytes and tests can capture it.
- `src/errors.ts`, `src/frontmatter.ts`
- `test/skills.test.ts`: in-process command tests against `test/fixture/skills`
- `test/integration.test.ts`: copies `test/fixture` to `test/.tmp`, runs `bun build --compile` and `bun main.ts` from another cwd

## Gotchas

- Bun macro args must be literals and `import.meta.dir` is the macro file's directory, hence the app-local `skills.macro.ts` wrapper (the fixture shows it).
- The fixture imports `effect-cli-skills` by package name (self-reference through `exports`); `test/.tmp` must stay inside the repo so that and `effect` resolve.
- Errors are exposed typed with `message` and `hint`; the library never prints or picks exit codes, the host app does (see `test/fixture/main.ts`).
- Checks: `pnpm check:type`, `pnpm check:lint`, `pnpm test`. `pnpm format` fixes Biome issues.
