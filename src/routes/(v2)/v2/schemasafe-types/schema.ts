import type { JSONSchema } from 'sveltekit-superforms';

// Define outside the load function so the adapter can be cached
export const schema = {
	type: 'object',
	properties: {
		name: { type: 'string', default: 'Hello world!' },
		email: { type: 'string', format: 'email' }
	},
	required: ['email'],
	additionalProperties: false,
	$schema: 'http://json-schema.org/draft-07/schema#'
} satisfies JSONSchema;

export const constSchema = {
	type: 'object',
	properties: {
		name: { type: 'string', default: 'Hello world!' },
		email: { type: 'string', format: 'email' }
	},
	required: ['email'],
	additionalProperties: false,
	$schema: 'http://json-schema.org/draft-07/schema#'
} as const satisfies JSONSchema;
