import { Effect } from 'effect';
import { InvalidSkill } from './errors.ts';

export interface ParsedSkill {
	readonly fields: Readonly<Record<string, string>>;
	readonly body: string;
}

const HINT = 'fix the SKILL.md frontmatter in the skill source';

const unquote = (value: string) =>
	value.length >= 2 && /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;

/** A leading `---` block of `key: value` lines; anything richer than that is not supported. */
export const parseFrontmatter = (path: string, text: string) => {
	const lines = text.split(/\r?\n/);
	const end = lines.indexOf('---', 1);
	if (lines[0] !== '---' || end === -1) {
		return new InvalidSkill({
			message: `${path}: missing the leading --- frontmatter block`,
			hint: HINT,
		});
	}
	const fields: Record<string, string> = {};
	for (const line of lines.slice(1, end)) {
		if (line.trim() === '') continue;
		const colon = line.indexOf(':');
		if (colon === -1) {
			return new InvalidSkill({
				message: `${path}: frontmatter line "${line}" is not key: value`,
				hint: HINT,
			});
		}
		fields[line.slice(0, colon).trim()] = unquote(line.slice(colon + 1).trim());
	}
	return Effect.succeed({
		fields,
		body: lines
			.slice(end + 1)
			.join('\n')
			.replace(/^\n+/, ''),
	} satisfies ParsedSkill);
};

export const requiredField = (
	path: string,
	parsed: ParsedSkill,
	key: string,
) => {
	const value = parsed.fields[key];
	return value === undefined || value === ''
		? new InvalidSkill({
				message: `${path}: frontmatter has no ${key}`,
				hint: HINT,
			})
		: Effect.succeed(value);
};
