import { Effect, Option, Stdio, Stream } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import {
	ConflictingFlags,
	InvalidPath,
	InvalidSkill,
	SkillNotFound,
} from './errors.ts';
import { parseFrontmatter, requiredField } from './frontmatter.ts';
import { SKILL_FILE, SkillSource } from './skill-source.ts';

const REFERENCES_PREFIX = 'references/';

export interface SkillsOptions {
	/** The CLI's own name; used in the stub and in the hints that tell an agent what to run. */
	readonly cli: string;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

const write = (data: string | Uint8Array) =>
	Effect.gen(function* () {
		const stdio = yield* Stdio.Stdio;
		yield* Stream.run(Stream.succeed(data), stdio.stdout({ endOnDone: false }));
	});

const loadSkill = (name: string) =>
	Effect.gen(function* () {
		const source = yield* SkillSource;
		const path = `${name}/${SKILL_FILE}`;
		const bytes = yield* source.read(name, SKILL_FILE);
		const text = yield* Effect.try({
			try: () => decoder.decode(bytes),
			catch: () =>
				new InvalidSkill({
					message: `${path}: not valid UTF-8`,
					hint: 'fix the SKILL.md in the skill source',
				}),
		});
		const parsed = yield* parseFrontmatter(path, text);
		const declared = yield* requiredField(path, parsed, 'name');
		if (declared !== name) {
			return yield* new InvalidSkill({
				message: `${path}: frontmatter name "${declared}" does not match its directory "${name}"`,
				hint: 'rename the skill directory or the frontmatter name so they match',
			});
		}
		return {
			name,
			description: yield* requiredField(path, parsed, 'description'),
			body: parsed.body,
		};
	});

const requireSkill = (options: SkillsOptions, name: string) =>
	Effect.gen(function* () {
		const names = yield* (yield* SkillSource).names;
		if (!names.includes(name)) {
			return yield* new SkillNotFound({
				message: `unknown skill "${name}"`,
				hint: `valid skills: ${names.length === 0 ? 'none' : names.join(', ')}; \`${options.cli} skills list\` shows them`,
			});
		}
		return name;
	});

const checkRelativePath = (options: SkillsOptions, path: string) =>
	path.startsWith('/') ||
	/^[A-Za-z]:/.test(path) ||
	path.includes('\\') ||
	path.split('/').includes('..')
		? new InvalidPath({
				message: `--file "${path}" must be a relative path inside the skill`,
				hint: `no absolute paths or ".."; \`${options.cli} skills get <skill>\` lists the files`,
			})
		: Effect.succeed(path);

const fileFooter = (
	options: SkillsOptions,
	skill: string,
	paths: ReadonlyArray<string>,
) =>
	paths.length === 0
		? ''
		: [
				'',
				'',
				`Other files in this skill (print one with \`${options.cli} skills get ${skill} --file <path>\`):`,
				...paths.map((path) => `- ${path}`),
			].join('\n');

const referenceName = (path: string) =>
	path.slice(REFERENCES_PREFIX.length).replace(/\.md$/, '');

const renderSkill = (
	options: SkillsOptions,
	name: string,
	flags: { readonly full: boolean; readonly file: Option.Option<string> },
) =>
	Effect.gen(function* () {
		if (flags.full && Option.isSome(flags.file)) {
			return yield* new ConflictingFlags({
				message: '--full and --file cannot be combined',
				hint: 'use --full for SKILL.md and every reference, or --file <path> for one file',
			});
		}
		const source = yield* SkillSource;
		yield* requireSkill(options, name);
		if (Option.isSome(flags.file)) {
			const path = yield* checkRelativePath(options, flags.file.value);
			if (path !== SKILL_FILE) return yield* source.read(name, path);
			return (yield* loadSkill(name)).body;
		}
		const skill = yield* loadSkill(name);
		const files = yield* source.files(name);
		if (!flags.full) {
			const others = files.filter((path) => path !== SKILL_FILE);
			return `${skill.body.trimEnd()}${fileFooter(options, name, others)}\n`;
		}
		const sections = [skill.body.trimEnd()];
		for (const path of files) {
			if (!path.startsWith(REFERENCES_PREFIX) || !path.endsWith('.md'))
				continue;
			const text = decoder.decode(yield* source.read(name, path));
			sections.push(`# reference: ${referenceName(path)}`, text.trimEnd());
		}
		return `${sections.join('\n\n')}\n`;
	});

const renderStub = (
	options: SkillsOptions,
	skill: { name: string; description: string },
) =>
	[
		'---',
		`name: ${options.cli}-${skill.name}`,
		`description: ${JSON.stringify(skill.description)}`,
		'---',
		'',
		`# ${options.cli} ${skill.name}`,
		'',
		`Run \`${options.cli} skills get ${skill.name}\` and follow what it prints. The full instructions ship inside the \`${options.cli}\` CLI, so they always match its version; this file never changes.`,
		`- More: \`${options.cli} skills get ${skill.name} --file <path>\` for one file, \`--full\` for the references.`,
		'',
	].join('\n');

/** The `skills` command: `list`, `get <name> [--file <path> | --full]`, `stub <name>`. Needs a `SkillSource`. */
export const skills = (options: SkillsOptions) => {
	const base = Command.make('skills').pipe(
		Command.withSharedFlags({
			json: Flag.Boolean('json').pipe(
				Flag.withDescription('print NDJSON even on a terminal'),
				Flag.withDefault(false),
			),
		}),
	);

	const list = (json: boolean) =>
		Effect.gen(function* () {
			const stdio = yield* Stdio.Stdio;
			const names = yield* (yield* SkillSource).names;
			const summaries = yield* Effect.forEach(names, loadSkill);
			if (!json && (yield* stdio.stdoutIsTerminal)) {
				const width = Math.max(...summaries.map((skill) => skill.name.length));
				yield* write(
					summaries
						.map(
							(skill) => `${skill.name.padEnd(width)}  ${skill.description}\n`,
						)
						.join(''),
				);
				return;
			}
			yield* write(
				summaries
					.map(
						(skill) =>
							`${JSON.stringify({ name: skill.name, description: skill.description })}\n`,
					)
					.join(''),
			);
		});

	const listCommand = Command.make('list', {}, () =>
		Effect.gen(function* () {
			const parent = yield* base;
			yield* list(parent.json);
		}),
	).pipe(
		Command.withShortDescription(`list the skills shipped with ${options.cli}`),
		Command.withDescription(
			'One line per skill: `name  description` on a terminal, NDJSON `{name, description}` when piped or with --json.',
		),
	);

	const getCommand = Command.make(
		'get',
		{
			name: Argument.String('name').pipe(
				Argument.withDescription(
					`skill name; see \`${options.cli} skills list\``,
				),
			),
			file: Flag.String('file').pipe(
				Flag.withDescription(
					'print one file of the skill, as raw bytes, instead of SKILL.md; paths are listed at the end of `get <name>`',
				),
				Flag.optional,
			),
			full: Flag.Boolean('full').pipe(
				Flag.withDescription(
					'SKILL.md followed by every file under references/, each under a `# reference: <name>` header',
				),
				Flag.withDefault(false),
			),
		},
		(args) =>
			renderSkill(options, args.name, {
				full: args.full,
				file: args.file,
			}).pipe(Effect.flatMap(write)),
	).pipe(
		Command.withShortDescription('print a skill'),
		Command.withDescription(
			'Print the skill (SKILL.md without its frontmatter, then the paths of its other files) on stdout. With --file, print that file byte for byte; SKILL.md loses its frontmatter. An unknown skill or file lists the valid names.',
		),
		Command.withExamples([
			{ command: `${options.cli} skills get <name>` },
			{
				command: `${options.cli} skills get <name> --file references/<file>.md`,
				description: 'one file',
			},
			{
				command: `${options.cli} skills get <name> --full`,
				description: 'SKILL.md and every reference',
			},
		]),
	);

	const stubCommand = Command.make(
		'stub',
		{
			name: Argument.String('name').pipe(
				Argument.withDescription(
					`skill name; see \`${options.cli} skills list\``,
				),
			),
		},
		(args) =>
			Effect.gen(function* () {
				yield* requireSkill(options, args.name);
				yield* write(renderStub(options, yield* loadSkill(args.name)));
			}),
	).pipe(
		Command.withShortDescription(
			'print a stub SKILL.md that points an agent here',
		),
		Command.withDescription(
			`Print a short SKILL.md that tells an agent to run \`${options.cli} skills get <name>\`. Save it as .claude/skills/${options.cli}-<name>/SKILL.md; it never goes stale because the real text comes from the CLI.`,
		),
	);

	return base.pipe(
		Command.withHandler((args) => list(args.json)),
		Command.withShortDescription(
			`read the agent skills shipped with ${options.cli}`,
		),
		Command.withDescription(
			`Guidance for AI agents, embedded in ${options.cli} so it matches the version you run. Without a subcommand it lists the skills.`,
		),
		Command.withSubcommands([listCommand, getCommand, stubCommand]),
	);
};
