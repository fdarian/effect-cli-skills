import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, Exit, Layer, Sink, Stdio } from 'effect';
import { Command } from 'effect/cli';
import { embedSkills } from '../src/embed.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import {
	ConflictingFlags,
	FileNotFound,
	InvalidPath,
	InvalidSkill,
	SkillNotFound,
	SkillSource,
	skills,
} from '../src/index.ts';

const fixtureSkills = join(import.meta.dir, 'fixture', 'skills');
const fixtureRecord = embedSkills(fixtureSkills);
const blob = new Uint8Array(
	await Bun.file(join(fixtureSkills, 'demo/assets/blob.bin')).arrayBuffer(),
);

const base64 = (text: string) => Buffer.from(text).toString('base64');
const skillMd = (fields: string, body = 'body\n') =>
	base64(`---\n${fields}\n---\n\n${body}`);

const run = async (
	args: ReadonlyArray<string>,
	options: { record?: Record<string, string>; tty?: boolean } = {},
) => {
	const chunks: Array<Uint8Array> = [];
	const stdio = Stdio.layerTest({
		stdoutIsTerminal: Effect.succeed(options.tty === true),
		stdout: () =>
			// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach is not Array.forEach
			Sink.forEach((chunk: string | Uint8Array) =>
				Effect.sync(() => {
					chunks.push(
						typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
					);
				}),
			),
	});
	const root = Command.make('app').pipe(
		Command.withSubcommands([skills({ cli: 'app' })]),
	);
	const exit = await Effect.runPromiseExit(
		Command.runWith(root, { version: '0.0.0' })(['skills', ...args]).pipe(
			Effect.provide(SkillSource.inline(options.record ?? fixtureRecord)),
			Effect.provide(
				Layer.mergeAll(BunServices.layer, stdio).pipe(Layer.orDie),
			),
		),
	);
	const bytes = new Uint8Array(Buffer.concat(chunks));
	return { exit, bytes, stdout: new TextDecoder().decode(bytes) };
};

const failure = (result: Awaited<ReturnType<typeof run>>) => {
	if (!Exit.isFailure(result.exit)) throw new Error('expected a failure');
	const error = result.exit.cause.reasons.find(
		(reason) => reason._tag === 'Fail',
	);
	if (error === undefined) throw new Error('expected a typed failure');
	return error.error;
};

describe('skills list', () => {
	test('prints an aligned text table when piped', async () => {
		const result = await run([]);
		expect(Exit.isSuccess(result.exit)).toBe(true);
		expect(result.stdout).toBe(
			[
				'demo   Use when testing: a skill with references, scripts and a binary asset',
				'other  A second skill with no extra files',
				'',
			].join('\n'),
		);
	});

	test('--json prints NDJSON, before or after the subcommand', async () => {
		const result = await run(['list', '--json']);
		expect(Exit.isSuccess(result.exit)).toBe(true);
		const records = result.stdout
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(records).toEqual([
			{
				name: 'demo',
				description:
					'Use when testing: a skill with references, scripts and a binary asset',
			},
			{ name: 'other', description: 'A second skill with no extra files' },
		]);
		for (const args of [['--json', 'list'], ['--json']]) {
			expect((await run(args)).stdout).toBe(result.stdout);
		}
	});

	test('output is the same on a terminal and when piped', async () => {
		for (const args of [['list'], [], ['list', '--json']]) {
			const piped = await run(args, { tty: false });
			const terminal = await run(args, { tty: true });
			expect(terminal.stdout).toBe(piped.stdout);
		}
	});

	test('ignores directories that have no SKILL.md', async () => {
		const result = await run([], {
			record: {
				'a/SKILL.md': skillMd('name: a\ndescription: A'),
				'b/notes.txt': base64('x'),
			},
		});
		expect(result.stdout).toBe('a  A\n');
	});
});

describe('skills get', () => {
	test('prints SKILL.md without frontmatter, then lists the other files', async () => {
		const result = await run(['get', 'demo']);
		expect(result.stdout.startsWith('# demo\n')).toBe(true);
		expect(result.stdout).not.toContain('description:');
		expect(result.stdout).toContain('`app skills get demo --file <path>`');
		expect(result.stdout.endsWith('- scripts/run.sh\n')).toBe(true);
		const listed = result.stdout
			.split('\n')
			.filter((line) => line.startsWith('- '));
		expect(listed).toEqual([
			'- assets/blob.bin',
			'- references/alpha.md',
			'- references/beta.md',
			'- references/deep/gamma.md',
			'- scripts/run.sh',
		]);
	});

	test('omits the footer when SKILL.md is the only file', async () => {
		const result = await run(['get', 'other']);
		expect(result.stdout).toBe('Just a body.\n');
	});

	test('--file prints a text file as is', async () => {
		const result = await run(['get', 'demo', '--file', 'references/alpha.md']);
		expect(result.stdout).toBe('# Alpha\n\nFirst reference.\n');
	});

	test('--file returns binary bytes unchanged', async () => {
		const result = await run(['get', 'demo', '--file', 'assets/blob.bin']);
		expect(result.bytes).toEqual(blob);
		expect(blob[10]).toBe(0xff);
	});

	test('--file SKILL.md strips the frontmatter and has no footer', async () => {
		const result = await run(['get', 'demo', '--file', 'SKILL.md']);
		expect(result.stdout.startsWith('# demo\n')).toBe(true);
		expect(result.stdout).not.toContain('Other files');
	});

	test('--full appends every references/ markdown file behind a header', async () => {
		const result = await run(['get', 'demo', '--full']);
		const headers = result.stdout
			.split('\n')
			.filter((line) => line.startsWith('# reference: '));
		expect(headers).toEqual([
			'# reference: alpha',
			'# reference: beta',
			'# reference: deep/gamma',
		]);
		expect(result.stdout).toContain('# Gamma\n');
		expect(result.stdout).not.toContain('hello from the script');
	});

	test('--full with --file is a ConflictingFlags error', async () => {
		const result = await run(['get', 'demo', '--full', '--file', 'SKILL.md']);
		expect(result.stdout).toBe('');
		expect(failure(result)).toBeInstanceOf(ConflictingFlags);
	});
});

describe('skills get errors', () => {
	test('an unknown skill lists the valid ones and names the list command', async () => {
		const error = failure(await run(['get', 'nope']));
		expect(error).toBeInstanceOf(SkillNotFound);
		expect((error as SkillNotFound).message).toBe('unknown skill "nope"');
		expect((error as SkillNotFound).hint).toBe(
			'valid skills: demo, other; `app skills list` shows them',
		);
	});

	test('an unknown file lists the valid ones', async () => {
		const error = failure(await run(['get', 'demo', '--file', 'nope.md']));
		expect(error).toBeInstanceOf(FileNotFound);
		expect((error as FileNotFound).hint).toContain('references/alpha.md');
	});

	test.each([
		'../other/SKILL.md',
		'references/../../other/SKILL.md',
		'/etc/passwd',
		'C:/windows/x',
		'references\\alpha.md',
	])('rejects the path %s', async (path) => {
		const result = await run(['get', 'demo', '--file', path]);
		expect(result.stdout).toBe('');
		expect(failure(result)).toBeInstanceOf(InvalidPath);
	});

	test('a skill whose frontmatter name differs from its directory is invalid', async () => {
		const record = { 'a/SKILL.md': skillMd('name: b\ndescription: A') };
		expect(failure(await run(['get', 'a'], { record }))).toBeInstanceOf(
			InvalidSkill,
		);
		expect(failure(await run([], { record }))).toBeInstanceOf(InvalidSkill);
	});

	test('a skill without a description is invalid', async () => {
		const record = { 'a/SKILL.md': skillMd('name: a') };
		expect(failure(await run(['get', 'a'], { record }))).toBeInstanceOf(
			InvalidSkill,
		);
	});

	test('a SKILL.md without frontmatter is invalid', async () => {
		const record = { 'a/SKILL.md': base64('# no frontmatter\n') };
		expect(failure(await run(['get', 'a'], { record }))).toBeInstanceOf(
			InvalidSkill,
		);
	});
});

describe('skills stub', () => {
	test('prints a SKILL.md that points at `skills get`', async () => {
		const result = await run(['stub', 'demo']);
		expect(result.stdout).toBe(
			[
				'---',
				'name: app-demo',
				'description: "Use when testing: a skill with references, scripts and a binary asset"',
				'---',
				'',
				'# app demo',
				'',
				'Run `app skills get demo` and follow what it prints. The full instructions ship inside the `app` CLI, so they always match its version; this file never changes.',
				'- More: `app skills get demo --file <path>` for one file, `--full` for the references.',
				'',
			].join('\n'),
		);
	});

	test('the stub frontmatter parses back to the skill description', async () => {
		const result = await run(['stub', 'demo']);
		const parsed = await Effect.runPromise(
			parseFrontmatter('stub', result.stdout),
		);
		expect(parsed.fields.name).toBe('app-demo');
		expect(parsed.fields.description).toBe(
			'Use when testing: a skill with references, scripts and a binary asset',
		);
	});

	test('an unknown skill is a SkillNotFound error', async () => {
		expect(failure(await run(['stub', 'nope']))).toBeInstanceOf(SkillNotFound);
	});
});

describe('embedSkills', () => {
	test('keys are <skill>/<relpath> and values are base64 of the bytes', () => {
		expect(Object.keys(fixtureRecord)).toEqual([
			'demo/SKILL.md',
			'demo/assets/blob.bin',
			'demo/references/alpha.md',
			'demo/references/beta.md',
			'demo/references/deep/gamma.md',
			'demo/scripts/run.sh',
			'other/SKILL.md',
		]);
		expect(
			Buffer.from(fixtureRecord['demo/assets/blob.bin'] as string, 'base64'),
		).toEqual(Buffer.from(blob));
	});

	test('rejects a skill directory without SKILL.md', () => {
		const dir = mkdtempSync(join(tmpdir(), 'embed-'));
		mkdirSync(join(dir, 'broken'));
		writeFileSync(join(dir, 'broken', 'notes.txt'), 'x');
		expect(() => embedSkills(dir)).toThrow('no SKILL.md');
		rmSync(dir, { recursive: true });
	});

	test('rejects a loose file next to the skill directories', () => {
		const dir = mkdtempSync(join(tmpdir(), 'embed-'));
		writeFileSync(join(dir, 'README.md'), 'x');
		expect(() => embedSkills(dir)).toThrow('expected one directory per skill');
		rmSync(dir, { recursive: true });
	});
});

describe('parseFrontmatter', () => {
	const parse = (text: string) =>
		Effect.runPromise(parseFrontmatter('SKILL.md', text));

	test('reads key: value lines and returns the body after the block', async () => {
		const parsed = await parse(
			'---\nname: core\ndescription: "Use: when it helps"\n---\n\n# Body\n',
		);
		expect(parsed.fields).toEqual({
			name: 'core',
			description: 'Use: when it helps',
		});
		expect(parsed.body).toBe('# Body\n');
	});

	test('rejects a missing block and a line that is not key: value', async () => {
		await expect(parse('# Body\n')).rejects.toBeInstanceOf(InvalidSkill);
		await expect(parse('---\nnot a pair\n---\nbody')).rejects.toBeInstanceOf(
			InvalidSkill,
		);
	});
});
