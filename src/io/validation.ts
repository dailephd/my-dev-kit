/**
 * Lightweight validation helpers for config loading and generator scripts.
 *
 * All functions throw descriptive errors on failure so callers can surface
 * exactly which field caused the problem.
 */

/**
 * Asserts that a value is a non-empty string.
 * Returns the string if valid; throws otherwise.
 */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Required field "${field}" must be a non-empty string, got: ${JSON.stringify(value)}`
    )
  }
  return value
}

/**
 * Asserts that a value is an array (may be empty).
 * Returns the array if valid; throws otherwise.
 */
export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Required field "${field}" must be an array, got: ${JSON.stringify(value)}`
    )
  }
  return value
}

/**
 * Asserts that a value is a non-empty array.
 * Returns the array if valid; throws otherwise.
 */
export function requireNonEmptyArray(value: unknown, field: string): unknown[] {
  const arr = requireArray(value, field)
  if (arr.length === 0) {
    throw new Error(`Required field "${field}" must be a non-empty array`)
  }
  return arr
}

/**
 * Asserts that a value is one of the allowed enum members.
 * Returns the typed value if valid; throws otherwise.
 */
export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  if (!allowed.includes(value as T)) {
    throw new Error(
      `Field "${field}" must be one of [${allowed.join(', ')}], got: ${JSON.stringify(value)}`
    )
  }
  return value as T
}

/**
 * Asserts that a value is a non-null plain object (not an array).
 * Returns the value cast to Record<string, unknown> if valid; throws otherwise.
 */
export function requireObject(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `Required field "${field}" must be an object, got: ${JSON.stringify(value)}`
    )
  }
  return value as Record<string, unknown>
}

/**
 * Asserts that a value is a boolean.
 * Returns the boolean if valid; throws otherwise.
 */
export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(
      `Required field "${field}" must be a boolean, got: ${JSON.stringify(value)}`
    )
  }
  return value
}

/**
 * Asserts an arbitrary condition, throwing a descriptive error on failure.
 */
export function assert(
  condition: boolean,
  field: string,
  message: string
): void {
  if (!condition) {
    throw new Error(`Validation failed for "${field}": ${message}`)
  }
}

/**
 * Builds a namespaced Error for use in subsystems that want a consistent
 * context prefix in their error messages.
 *
 * @example
 *   throw validationError('configLoader', 'Missing required section: layers');
 */
export function validationError(context: string, message: string): Error {
  return new Error(`[${context}] ${message}`)
}

