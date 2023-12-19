import { validate } from '@decs/typeschema';
import { traversePath } from './traversal.js';
import { ActionFailure, fail, type RequestEvent } from '@sveltejs/kit';
import { mapAdapter, type ValidationAdapter, type ValidationResult } from './adapters/index.js';
import { parseRequest } from './formData.js';
import type { SuperValidated } from './index.js';
import type { NumericRange } from './utils.js';
import { splitPath, type StringPathLeaves } from './stringPath.js';
import type { JSONSchema } from './jsonSchema/index.js';
import { mapErrors } from './errors.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz123456789', 6);

// TODO: Where and when to generate id?
function formId() {
	return nanoid();
}

//type NeedDefaults<T extends Schema> = Lib<T> extends 'zod' ? false : true;
//type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

type SuperValidateSyncData<T extends object> =
	| FormData
	| URLSearchParams
	| URL
	| Partial<T>
	| null
	| undefined;

type SuperValidateData<T extends object> = RequestEvent | Request | SuperValidateSyncData<T>;

export type SuperValidateOptions<T extends object> = Partial<{
	errors: boolean;
	id: string;
	preprocessed: (keyof T)[];
	defaults: T;
	jsonSchema: JSONSchema;
	strict: boolean;
}>;

export async function superValidate<
	T extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	M = App.Superforms.Message extends never ? any : App.Superforms.Message
>(adapter: ValidationAdapter<T>, options?: SuperValidateOptions<T>): Promise<SuperValidated<T, M>>;

export async function superValidate<
	T extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	M = App.Superforms.Message extends never ? any : App.Superforms.Message
>(
	data: SuperValidateData<T>,
	adapter: ValidationAdapter<T>,
	options?: SuperValidateOptions<T>
): Promise<SuperValidated<T, M>>;

/**
 * Validates a schema for data validation and usage in superForm.
 * @param data Data corresponding to a schema, or RequestEvent/FormData/URL. If falsy, the schema's default values will be used.
 * @param schema The schema to validate against.
 */
export async function superValidate<
	T extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	M = App.Superforms.Message extends never ? any : App.Superforms.Message
>(
	data: ValidationAdapter<T> | SuperValidateData<T>,
	adapter?: ValidationAdapter<T> | SuperValidateData<T> | SuperValidateOptions<T>,
	options?: SuperValidateOptions<T>
): Promise<SuperValidated<T, M>> {
	if (data && 'superFormValidationLibrary' in data) {
		options = adapter as SuperValidateOptions<T>;
		adapter = data;
		data = undefined;
	}

	const validation = mapAdapter(adapter as ValidationAdapter<T>);

	const defaults = options?.defaults ?? validation.defaults;
	const jsonSchema = options?.jsonSchema ?? validation.jsonSchema;
	const addErrors = options?.errors ?? (options?.strict ? true : !!data);

	const parsed = await parseRequest<T>(data, jsonSchema, options);
	const hasData = !!parsed.data;

	// Merge with defaults in non-strict mode.
	parsed.data = { ...(options?.strict ? {} : defaults), ...(parsed.data ?? {}) } as T;

	const status: ValidationResult<T> =
		hasData || addErrors
			? validation.customValidator
				? await validation.customValidator(parsed.data)
				: ((await validate(validation.validator, parsed.data)) as ValidationResult<T>)
			: { success: false, issues: [] };

	const valid = status.success;
	const errors = valid || !addErrors ? {} : mapErrors(status.issues, validation.objects);

	const finalData = valid ? status.data : parsed.data;
	let outputData: typeof finalData;

	if (!jsonSchema.additionalProperties) {
		// Strip keys not belonging to schema
		outputData = {};
		for (const key of Object.keys(jsonSchema.properties ?? {})) {
			if (key in finalData) outputData[key] = finalData[key];
			else if (defaults[key] !== undefined) outputData[key] = defaults[key];
		}
	} else {
		outputData = finalData;
		for (const key of Object.keys(defaults)) {
			if (!(key in finalData) && defaults[key] !== undefined) {
				outputData[key] = defaults[key];
			}
		}
	}

	// TODO: Form id must be derived on schema as in v1? (can skip undefined)
	// Depends on how id is updated when load function is invalidated.
	return {
		id: parsed.id ?? options?.id ?? (parsed.posted ? undefined : formId()),
		valid,
		posted: parsed.posted,
		errors,
		data: outputData as T,
		constraints: validation.constraints
	};
}

/**
 * Sends a message with a form, with an optional HTTP status code that will set
 * form.valid to false if status >= 400. A status lower than 400 cannot be sent.
 */
export function message<T extends Record<string, unknown>, M>(
	form: SuperValidated<T, M>,
	message: M,
	options?: {
		status?: NumericRange<400, 599>;
	}
) {
	if (options?.status && options.status >= 400) {
		form.valid = false;
	}

	form.message = message;
	return !form.valid ? fail(options?.status ?? 400, { form }) : { form };
}

export const setMessage = message;

type SetErrorOptions = {
	overwrite?: boolean;
	status?: NumericRange<400, 599>;
};

/**
 * Sets a form-level error.
 * form.valid is automatically set to false.
 *
 * @param {SuperValidated<T, unknown>} form A validation object, usually returned from superValidate.
 * @param {string | string[]} error Error message(s).
 * @param {SetErrorOptions} options Option to overwrite previous errors and set a different status than 400. The status must be in the range 400-599.
 * @returns fail(status, { form })
 */
export function setError<T extends Record<string, unknown>>(
	form: SuperValidated<T, unknown>,
	error: string | string[],
	options?: SetErrorOptions
): ActionFailure<{ form: SuperValidated<T, unknown> }>;

/**
 * Sets an error for a form field or array field.
 * form.valid is automatically set to false.
 *
 * @param {SuperValidated<T, unknown>} form A validation object, usually returned from superValidate.
 * @param {'' | StringPathLeaves<T, '_errors'>} path Path to the form field. Use an empty string to set a form-level error. Array-level errors can be set by appending "._errors" to the field.
 * @param {string | string[]} error Error message(s).
 * @param {SetErrorOptions} options Option to overwrite previous errors and set a different status than 400. The status must be in the range 400-599.
 * @returns fail(status, { form })
 */
export function setError<T extends Record<string, unknown>>(
	form: SuperValidated<T, unknown>,
	path: '' | StringPathLeaves<T, '_errors'>,
	error: string | string[],
	options?: SetErrorOptions
): ActionFailure<{ form: SuperValidated<T, unknown> }>;

export function setError<T extends Record<string, unknown>>(
	form: SuperValidated<T, unknown>,
	path: string | string[] | (string & StringPathLeaves<T, '_errors'>),
	error?: string | string[] | SetErrorOptions,
	options?: SetErrorOptions
): ActionFailure<{ form: SuperValidated<T, unknown> }> {
	// Unify signatures
	if (error == undefined || (typeof error !== 'string' && !Array.isArray(error))) {
		options = error;
		error = path;
		path = '';
	}

	if (options === undefined) options = {};

	const errArr = Array.isArray(error) ? error : [error];

	if (!form.errors) form.errors = {};

	if (path === null || path === '') {
		if (!form.errors._errors) form.errors._errors = [];
		form.errors._errors = options.overwrite ? errArr : form.errors._errors.concat(errArr);
	} else {
		const realPath = splitPath(path as string);

		const leaf = traversePath(form.errors, realPath, ({ parent, key, value }) => {
			if (value === undefined) parent[key] = {};
			return parent[key];
		});

		if (leaf) {
			leaf.parent[leaf.key] =
				Array.isArray(leaf.value) && !options.overwrite ? leaf.value.concat(errArr) : errArr;
		}
	}

	form.valid = false;
	return fail(options.status ?? 400, { form });
}
