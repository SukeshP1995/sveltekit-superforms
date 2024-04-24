import type { JSONSchema } from '$lib/jsonSchema/index.js';
import { memoize } from '$lib/memoize.js';
import { createAdapter, type AdapterOptions, type ValidationAdapter, type ValidationResult } from './adapters.js';
import { BASIC, addKeyword, buildSchemaDocument, compile, getSchema, interpret, unloadDialect } from '@hyperjump/json-schema/experimental';
import * as Instance from "@hyperjump/json-schema/instance/experimental";
import * as Schema from "@hyperjump/json-schema/draft-07";
import { validate, type OutputFormat, type SchemaObject } from "@hyperjump/json-schema/draft-07";
import * as Browser from "@hyperjump/browser";

// From https://github.com/sinclairzx81/typebox/tree/ca4d771b87ee1f8e953036c95a21da7150786d3e/example/formats
const Email =
	/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

addKeyword({
	id: "https://json-schema.org/keyword/format",
	compile: (schema) => Browser.value(schema),
	interpret: (format, instance) => {
		switch (format) {
			case "email":
				return Email.test(Instance.value(instance));
			default:
				return true;
			}
	}
});

function _hyperjump<T extends JSONSchema>(
	schema: JSONSchema,
	options?: AdapterOptions<T>
): ValidationAdapter<Record<string, unknown>> {

	const schemaDoc = buildSchemaDocument(schema as SchemaObject, "", "");
	return createAdapter({
		superFormValidationLibrary: 'hyperjump',
		jsonSchema: schema as JSONSchema,
		defaults: options?.defaults,
		async validate(data: unknown): Promise<ValidationResult<Record<string, unknown>>> {
			const _schema = await getSchema(schemaDoc.baseUri, { _cache: { [schemaDoc.baseUri]: schemaDoc } });
			const compiled = await compile(_schema);
			const output = interpret(compiled, Instance.cons(data), BASIC);
			
			unloadDialect(schemaDoc.baseUri);
			if (output.valid) {
				return {
					data: data as Record<string, unknown>,
					success: true
				};
			}
			return {
				issues: (output.errors ?? []).map(({instanceLocation, keyword}) => ({
					message: keyword,
					path: instanceLocation.split('/').slice(1)
				})),
				success: false
			};
		}
	});
}

export const hyperjump = /* @__PURE__ */ memoize(_hyperjump);