export function parseInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Expected an integer, got "${value}".`)
  return parsed
}
