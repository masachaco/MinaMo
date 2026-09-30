let n = 0;
export function uid(): string {
  n = (n + 1) % 1e6;
  return Date.now().toString(36) + '-' + n.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}
