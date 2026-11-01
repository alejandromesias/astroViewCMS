// Helpers shared by the schemas of this package. A JSON object is a plain
// object that is not an array, `null` is not one.
import { z } from 'zod';

/** Checks that a value is a non-array object, as a JSON object is. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A schema that accepts a JSON object and refuses anything else with `error`
 *  as the message. */
export function objectOf(error: string) {
  return z.custom<Record<string, unknown>>(isObject, { error });
}
