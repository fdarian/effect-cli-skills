import { Buffer } from 'node:buffer';
import { Context, Effect, Layer } from 'effect';
import { FileNotFound, SkillNotFound } from './errors.ts';

export const SKILL_FILE = 'SKILL.md';

const validList = (values: ReadonlyArray<string>) =>
	values.length === 0 ? 'none' : values.join(', ');

/** Where skills come from. Paths are `/`-separated and relative to the skill directory. */
export class SkillSource extends Context.Service<
	SkillSource,
	{
		/** Skills that have a SKILL.md, sorted. */
		readonly names: Effect.Effect<ReadonlyArray<string>>;
		/** Every file of one skill, sorted. */
		readonly files: (
			skill: string,
		) => Effect.Effect<ReadonlyArray<string>, SkillNotFound>;
		readonly read: (
			skill: string,
			path: string,
		) => Effect.Effect<Uint8Array, SkillNotFound | FileNotFound>;
	}
>()('effect-cli-skills/SkillSource') {
	/**
	 * Serves a `Record<"<skill>/<relative path>", base64>`, the shape `embedSkills` returns.
	 * Meant to be filled by a Bun macro so the files are baked into the binary.
	 */
	static readonly inline = (record: Readonly<Record<string, string>>) => {
		const byKey = new Map(Object.entries(record));
		const filesBySkill = new Map<string, Array<string>>();
		for (const key of [...byKey.keys()].sort()) {
			const slash = key.indexOf('/');
			if (slash === -1) continue;
			const skill = key.slice(0, slash);
			const files = filesBySkill.get(skill) ?? [];
			files.push(key.slice(slash + 1));
			filesBySkill.set(skill, files);
		}
		for (const [skill, files] of filesBySkill) {
			if (!files.includes(SKILL_FILE)) filesBySkill.delete(skill);
		}
		const names = [...filesBySkill.keys()].sort();

		const files = (skill: string) => {
			const found = filesBySkill.get(skill);
			return found === undefined
				? Effect.fail(
						new SkillNotFound({
							message: `unknown skill "${skill}"`,
							hint: `valid skills: ${validList(names)}`,
						}),
					)
				: Effect.succeed(found);
		};

		return Layer.succeed(SkillSource, {
			names: Effect.succeed(names),
			files,
			read: (skill, path) =>
				Effect.flatMap(files(skill), (available) => {
					const encoded = byKey.get(`${skill}/${path}`);
					return encoded === undefined
						? Effect.fail(
								new FileNotFound({
									message: `skill "${skill}" has no file "${path}"`,
									hint: `valid files: ${validList(available)}`,
								}),
							)
						: Effect.succeed(new Uint8Array(Buffer.from(encoded, 'base64')));
				}),
		});
	};
}
