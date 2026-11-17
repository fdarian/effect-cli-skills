# effect-cli-skills

A read-only `skills` command for Effect v4 CLIs. Ship agent skills (a `SKILL.md` plus references, scripts, even binary assets) inside your binary, so `<cli> skills get <name>` always matches the CLI version the agent is running.

## Install

```sh
pnpm add github:fdarian/effect-cli-skills#v0.1.0
```

Needs `effect` ^4.0.5 and Bun (the embedding uses a Bun macro).

## Use

Put skills in a folder, one directory per skill, each with a `SKILL.md`:

```
skills/
  guide/
    SKILL.md          # frontmatter: name (= directory name) and description
    references/*.md
    assets/logo.png
```

Add a macro file next to it. It lives in your app because `import.meta.dir` must point at your files:

```ts
// src/skills.macro.ts
import { embedSkills } from 'effect-cli-skills/embed';

export const skills = () => embedSkills(`${import.meta.dir}/../skills`);
```

Mount the command and provide the source:

```ts
import { SkillSource, skills } from 'effect-cli-skills';
import { skills as embedded } from './skills.macro.ts' with { type: 'macro' };

const root = Command.make('mycli').pipe(
	Command.withSubcommands([skills({ cli: 'mycli' })]),
);

run(args).pipe(Effect.provide(SkillSource.inline(embedded())));
```

The macro runs under `bun src/main.ts` and `bun build --compile`; the files are baked into the result. The command also needs the usual `BunServices.layer`.

## Commands

| Command | Output |
| --- | --- |
| `mycli skills` / `skills list` | `name  description` table on a terminal; NDJSON `{name, description}` when piped or with `--json` |
| `skills get <name>` | SKILL.md without frontmatter, then the paths of the skill's other files |
| `skills get <name> --file <path>` | that file's raw bytes (binary-safe); absolute paths and `..` are rejected |
| `skills get <name> --full` | SKILL.md plus every `references/**/*.md`, each under a `# reference: <name>` header |
| `skills stub <name>` | a short SKILL.md (`name: mycli-<name>`) telling an agent to run `mycli skills get <name>`; save it under `.claude/skills/` |

## Errors

Failures are tagged errors, each with `message` and `hint` (valid names, valid files): `SkillNotFound`, `FileNotFound`, `InvalidPath`, `ConflictingFlags`, `InvalidSkill`. Your CLI decides how to print them and which exit code to use; the union is exported as `SkillsError`.

## Development

```sh
pnpm install
pnpm check:type && pnpm check:lint && pnpm test
```

## License

MIT
