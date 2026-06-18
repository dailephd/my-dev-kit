// A production file that has a function named "test" — should NOT be classified as test file
export function test(value: unknown): boolean {
  return value !== null && value !== undefined
}

export function describe(text: string): string {
  return text.toLowerCase()
}
