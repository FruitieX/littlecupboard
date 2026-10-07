// Returns `next`, reusing every subtree of `previous` that is deeply equal.
// Unchanged objects keep their identity, so memoized components and effects
// that depend on them skip work when a server snapshot repeats known data.
export function replaceEqualDeep<T>(previous: unknown, next: T): T {
  if (previous === next) return next
  const bothArrays = Array.isArray(previous) && Array.isArray(next)
  if (!bothArrays && !(isPlainObject(previous) && isPlainObject(next)))
    return next
  const before = previous as Record<string, unknown>
  const after = next as Record<string, unknown>
  const keys = Object.keys(after)
  const previousKeys = Object.keys(before)
  const copy = (bothArrays ? [] : {}) as Record<string, unknown>
  let same = keys.length === previousKeys.length
  for (const key of keys) {
    const value = replaceEqualDeep(before[key], after[key])
    copy[key] = value
    if (value !== before[key] || !(key in before)) same = false
  }
  return (same ? previous : copy) as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
