/**
 * `n` and what it counts, worded for that many: "1 shape", "2 shapes". `many` is the plural when it isn't `one`
 * plus "s", which lets a verb agree too: `counted(n, "carve area is", "carve areas are")`.
 */
export function counted(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
