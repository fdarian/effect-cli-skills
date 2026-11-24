import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Inside the repo so the fixture resolves `effect-cli-skills` and `effect` from node_modules.
const scratchRoot = join(import.meta.dir, '.tmp');
mkdirSync(scratchRoot, { recursive: true });
const work = mkdtempSync(join(scratchRoot, 'it-'));
const elsewhere = mkdtempSync(join(tmpdir(), 'ecs-cwd-'));
const binary = join(work, 'fixture-cli');
const main = join(work, 'main.ts');

// Larger than a pipe buffer, so a truncated write on exit would show.
const big = new Uint8Array(512 * 1024).map(
	(_, index) => (index * 31 + 7) % 256,
);

const exec = async (command: ReadonlyArray<string>) => {
	const child = Bun.spawn([...command], {
		cwd: elsewhere,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout: new Uint8Array(stdout), stderr, code };
};

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

beforeAll(async () => {
	cpSync(join(import.meta.dir, 'fixture'), work, { recursive: true });
	writeFileSync(join(work, 'skills/demo/assets/big.bin'), big);
	const build = await exec([
		'bun',
		'build',
		'--compile',
		main,
		'--outfile',
		binary,
	]);
	expect(build.code).toBe(0);
});

afterAll(() => {
	rmSync(work, { recursive: true, force: true });
	rmSync(elsewhere, { recursive: true, force: true });
});

const targets = {
	'bun build --compile': () => [binary],
	'bun from source': () => ['bun', main],
};

for (const [label, command] of Object.entries(targets)) {
	describe(`fixture CLI, ${label}, run from another cwd`, () => {
		test('skills get prints the embedded SKILL.md', async () => {
			const result = await exec([...command(), 'skills', 'get', 'demo']);
			expect(result.code).toBe(0);
			expect(text(result.stdout).startsWith('# demo\n')).toBe(true);
			expect(text(result.stdout)).toContain('- assets/big.bin');
		});

		test('skills list is text when piped', async () => {
			const result = await exec([...command(), 'skills']);
			const names = text(result.stdout)
				.trim()
				.split('\n')
				.map((line) => line.split(/\s+/)[0]);
			expect(names).toEqual(['demo', 'other']);
			expect(text(result.stdout)).not.toContain('{');
		});

		test('skills list --json is NDJSON', async () => {
			const result = await exec([...command(), 'skills', 'list', '--json']);
			const names = text(result.stdout)
				.trim()
				.split('\n')
				.map((line) => (JSON.parse(line) as { name: string }).name);
			expect(names).toEqual(['demo', 'other']);
		});

		test('--file round-trips binary bytes, small and large', async () => {
			const small = await exec([
				...command(),
				'skills',
				'get',
				'demo',
				'--file',
				'assets/blob.bin',
			]);
			expect(small.stdout).toEqual(
				readFileSync(join(work, 'skills/demo/assets/blob.bin')),
			);
			const large = await exec([
				...command(),
				'skills',
				'get',
				'demo',
				'--file',
				'assets/big.bin',
			]);
			expect(large.code).toBe(0);
			expect(large.stdout.byteLength).toBe(big.byteLength);
			expect(large.stdout).toEqual(big);
		});

		test('an unknown skill exits 2 with the hint on stderr', async () => {
			const result = await exec([...command(), 'skills', 'get', 'nope']);
			expect(result.code).toBe(2);
			expect(result.stdout.byteLength).toBe(0);
			expect(result.stderr).toContain('hint: valid skills: demo, other');
		});
	});
}

describe('macro and source edits', () => {
	test('from source, an edited skill file shows up on the next run', async () => {
		const skillFile = join(work, 'skills/other/SKILL.md');
		const original = readFileSync(skillFile, 'utf8');
		const before = await exec(['bun', main, 'skills', 'get', 'other']);
		expect(text(before.stdout)).toBe('Just a body.\n');
		writeFileSync(skillFile, original.replace('Just a body.', 'Changed body.'));
		const after = await exec(['bun', main, 'skills', 'get', 'other']);
		expect(text(after.stdout)).toBe('Changed body.\n');
		writeFileSync(skillFile, original);
	});
});
