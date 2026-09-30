/** Tidur singkat untuk memperlambat percobaan login berulang. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}