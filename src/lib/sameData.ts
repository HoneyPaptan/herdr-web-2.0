export function sameData(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function keepIfSame<T>(previous: T, next: T): T {
  return sameData(previous, next) ? previous : next;
}
