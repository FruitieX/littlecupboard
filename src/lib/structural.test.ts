import { describe, expect, it } from 'vitest'
import { replaceEqualDeep } from './structural'

describe('replaceEqualDeep', () => {
  it('returns the previous value when nothing changed', () => {
    const previous = { items: [{ id: 'a', quantity: 1 }], name: 'Home' }
    const next = JSON.parse(JSON.stringify(previous))
    expect(replaceEqualDeep(previous, next)).toBe(previous)
  })

  it('keeps unchanged siblings while replacing changed branches', () => {
    const previous = {
      items: [
        { id: 'a', quantity: 1 },
        { id: 'b', quantity: 2 },
      ],
      stores: [{ id: 's' }],
    }
    const next = JSON.parse(JSON.stringify(previous))
    next.items[1].quantity = 3
    const result = replaceEqualDeep(previous, next)
    expect(result).not.toBe(previous)
    expect(result.stores).toBe(previous.stores)
    expect(result.items[0]).toBe(previous.items[0])
    expect(result.items[1]).toEqual({ id: 'b', quantity: 3 })
  })

  it('detects added and removed keys and array length changes', () => {
    const previous = { a: 1, list: [1, 2] } as Record<string, unknown>
    expect(replaceEqualDeep(previous, { a: 1 })).toEqual({ a: 1 })
    expect(replaceEqualDeep(previous, { a: 1, list: [1, 2], b: 2 })).toEqual({
      a: 1,
      list: [1, 2],
      b: 2,
    })
    expect(replaceEqualDeep(previous, { a: 1, list: [1] })).toEqual({
      a: 1,
      list: [1],
    })
  })
})
