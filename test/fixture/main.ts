import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect } from 'effect';
import { Command } from 'effect/cli';
import { SkillSource, type SkillsError, skills } from 'effect-cli-skills';
import { skills as embedded } from './skills.macro.ts' with { type: 'macro' };

const root = Command.make('fixture').pipe(
	Command.withSubcommands([skills({ cli: 'fixture' })]),
);

const SKILLS_ERRORS: ReadonlyArray<string> = [
	'SkillNotFound',
	'FileNotFound',
	'InvalidPath',
	'ConflictingFlags',
	'InvalidSkill',
];

const isSkillsError = (error: unknown): error is SkillsError =>
	typeof error === 'object' &&
	error !== null &&
	'_tag' in error &&
	typeof error._tag === 'string' &&
	SKILLS_ERRORS.includes(error._tag);

class Exit2 {
	readonly _tag = 'Exit2';
}

Command.runWith(root, { version: '0.0.0' })(process.argv.slice(2)).pipe(
	Effect.catchIf(isSkillsError, (error) =>
		Console.error(`error: ${error.message}\nhint: ${error.hint}`).pipe(
			Effect.andThen(Effect.fail(new Exit2())),
		),
	),
	Effect.provide(SkillSource.inline(embedded())),
	Effect.provide(BunServices.layer),
	BunRuntime.runMain({
		disableErrorReporting: true,
		teardown: (exit, onExit) => {
			onExit(exit._tag === 'Success' ? 0 : 2);
		},
	}),
);
