import { Schema } from 'effect';

/** Every error carries a `hint` so a host can render `message` then `hint:` without knowing the type. */

export class SkillNotFound extends Schema.TaggedError<SkillNotFound>()(
	'SkillNotFound',
	{ message: Schema.String, hint: Schema.String },
) {}

export class FileNotFound extends Schema.TaggedError<FileNotFound>()(
	'FileNotFound',
	{ message: Schema.String, hint: Schema.String },
) {}

/** `--file` was absolute or tried to leave the skill directory. */
export class InvalidPath extends Schema.TaggedError<InvalidPath>()(
	'InvalidPath',
	{ message: Schema.String, hint: Schema.String },
) {}

export class ConflictingFlags extends Schema.TaggedError<ConflictingFlags>()(
	'ConflictingFlags',
	{ message: Schema.String, hint: Schema.String },
) {}

/** A shipped skill that breaks the layout: a bug in the skills, not in the invocation. */
export class InvalidSkill extends Schema.TaggedError<InvalidSkill>()(
	'InvalidSkill',
	{ message: Schema.String, hint: Schema.String },
) {}

export type SkillsError =
	| SkillNotFound
	| FileNotFound
	| InvalidPath
	| ConflictingFlags
	| InvalidSkill;
