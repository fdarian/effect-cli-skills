import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_FILE = 'SKILL.md';

/**
 * Reads every file under `dir` (one subdirectory per skill) into a JSON-safe record keyed
 * `<skill>/<relative path>`, with base64 values. Bun macros cannot return a Uint8Array, hence base64.
 * Must stay free of `effect` imports so the macro that calls it starts fast.
 */
export const embedSkills = (dir: string): Record<string, string> => {
	const record: Record<string, string> = {};
	const walk = (relative: string) => {
		for (const entry of readdirSync(join(dir, relative)).sort()) {
			if (entry === '.DS_Store') continue;
			const next = relative === '' ? entry : `${relative}/${entry}`;
			if (statSync(join(dir, next)).isDirectory()) {
				walk(next);
			} else if (relative === '') {
				throw new Error(
					`${join(dir, entry)}: expected one directory per skill, found a file`,
				);
			} else {
				record[next] = readFileSync(join(dir, next)).toString('base64');
			}
		}
	};
	walk('');
	for (const key of Object.keys(record)) {
		const skill = key.slice(0, key.indexOf('/'));
		if (!(`${skill}/${SKILL_FILE}` in record)) {
			throw new Error(`${join(dir, skill)}: no ${SKILL_FILE}`);
		}
	}
	return record;
};
