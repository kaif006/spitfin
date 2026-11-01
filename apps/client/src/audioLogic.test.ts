import { describe, expect, it } from 'vitest'
import { RateLimiter, clampVolume, envelopeAt, MIN_GAP_MS } from './audioLogic'

describe('RateLimiter', () => {
  it('allows the first call', () => {
    expect(new RateLimiter().allow('spit', 0)).toBe(true)
  })
  it('blocks calls inside the gap and allows after', () => {
    const r = new RateLimiter()
    r.allow('hit', 1000)
    expect(r.allow('hit', 1000 + MIN_GAP_MS.hit - 1)).toBe(false)
    expect(r.allow('hit', 1000 + MIN_GAP_MS.hit)).toBe(true)
  })
  it('tracks names independently', () => {
    const r = new RateLimiter()
    r.allow('hit', 0)
    expect(r.allow('eat', 1)).toBe(true)
  })
  it('reset clears history', () => {
    const r = new RateLimiter()
    r.allow('nip', 0)
    r.reset()
    expect(r.allow('nip', 1)).toBe(true)
  })
})

describe('clampVolume', () => {
  it('clamps and rejects non-finite', () => {
    expect(clampVolume(-1)).toBe(0)
    expect(clampVolume(2)).toBe(1)
    expect(clampVolume(0.4)).toBe(0.4)
    expect(clampVolume(NaN)).toBe(0)
  })
})

describe('envelopeAt', () => {
  it('rises then decays to zero', () => {
    expect(envelopeAt(-0.1, 0.01, 0.2)).toBe(0)
    expect(envelopeAt(0.005, 0.01, 0.2)).toBeCloseTo(0.5)
    expect(envelopeAt(0.01, 0.01, 0.2)).toBeCloseTo(1)
    expect(envelopeAt(0.11, 0.01, 0.2)).toBeCloseTo(0.25)
    expect(envelopeAt(0.3, 0.01, 0.2)).toBe(0)
  })
  it('handles zero decay', () => {
    expect(envelopeAt(0.5, 0, 0)).toBe(0)
  })
})
