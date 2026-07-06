import { describe, it, expect } from 'vitest'
import { equal, betaReduceAt, boundVarOccurrences, nodeCount, getAt } from './term'
import { redexes, pickRedex, normalize } from './reduce'
import { parse, church, ParseError } from './parser'
import { DICTIONARY, parseWithDict } from './dict'
import { pretty, prettyPrint } from './pretty'

const p = parseWithDict

describe('parser', () => {
  it('parses identity applied to a free variable', () => {
    expect(pretty(p('(λx. x) y'))).toBe('(λx. x) y')
  })

  it('treats application as left-associative', () => {
    expect(pretty(p('a b c'))).toBe('a b c')
    expect(equal(p('a b c'), p('(a b) c'))).toBe(true)
    expect(equal(p('a b c'), p('a (b c)'))).toBe(false)
  })

  it('supports multi-binder sugar', () => {
    expect(equal(p('λx y. x'), p('λx. λy. x'))).toBe(true)
  })

  it('lets bodies extend max-right and backslash bind', () => {
    expect(equal(p('\\x. x x'), p('λx. (x x)'))).toBe(true)
  })

  it('allows a trailing unparenthesized lambda as final argument', () => {
    expect(equal(p('a λx. x'), p('a (λx. x)'))).toBe(true)
  })

  it('expands numerals to Church numerals', () => {
    expect(equal(p('2'), p('λf x. f (f x)'))).toBe(true)
    expect(equal(p('0'), p('λf x. x'))).toBe(true)
  })

  it('resolves dictionary names and leaves unknown names free', () => {
    expect(equal(p('I'), p('λq. q'))).toBe(true)
    const t = p('mystery')
    expect(t.kind).toBe('free')
  })

  it('rejects malformed input with a position', () => {
    expect(() => p('λ. x')).toThrow(ParseError)
    expect(() => p('(x')).toThrow(ParseError)
    expect(() => p('x)')).toThrow(ParseError)
  })
})

describe('pretty-printer', () => {
  it('round-trips: parse(pretty(t)) is alpha-equal to t', () => {
    const samples = ['λx y. x', '(λx. x x) (λx. x x)', 'PLUS 2 3', 'λf. (λx. f (x x)) (λx. f (x x))', 'a (b c) d', 'λx. x λy. y x']
    for (const s of samples) {
      const t = p(s)
      expect(equal(parse(pretty(t)), t)).toBe(true)
    }
  })

  it('primes colliding display names instead of capturing', () => {
    // λx. (λx. x) x — inner binder hint collides with outer
    const t = p('λx. (λx. x) x')
    const text = pretty(t)
    expect(text).toBe('λx. (λx′. x′) x')
  })

  it('produces one span per node, covering the node text', () => {
    const t = p('(λx. x) y')
    const { text, spans } = prettyPrint(t)
    expect(spans.length).toBe(nodeCount(t))
    const root = spans.find((s) => s.path === '')!
    expect(text.slice(root.start, root.end)).toBe(text)
  })
})

describe('substitution and beta', () => {
  it('reduces the identity', () => {
    expect(equal(betaReduceAt(p('(λx. x) y'), []), p('y'))).toBe(true)
  })

  it('discards unused arguments (K)', () => {
    const t = betaReduceAt(p('K a b'), ['fn'])
    expect(equal(betaReduceAt(t, []), p('a'))).toBe(true)
  })

  it('avoids capture: (λx. λy. x) y → λy′. y (free y stays free)', () => {
    const r = betaReduceAt(p('(λx. λy. x) y'), [])
    // body of result lambda must be the FREE y, not the bound one
    expect(r.kind).toBe('lam')
    expect(getAt(r, ['body']).kind).toBe('free')
    expect(pretty(r)).toBe('λy′. y')
  })

  it('handles de Bruijn shifts under nested binders', () => {
    // (λx. λy. y x) a → λy. y a
    const r = betaReduceAt(p('(λx. λy. y x) a'), [])
    expect(equal(r, p('λy. y a'))).toBe(true)
  })
})

describe('redex enumeration', () => {
  it('finds all redexes in leftmost-outermost order', () => {
    // ((λx.x) a) ((λy.y) b) — two redexes; whole term is not a redex
    const t = p('((λx. x) a) ((λy. y) b)')
    const rs = redexes(t)
    expect(rs.map((r) => r.join('/'))).toEqual(['fn', 'arg'])
  })

  it('sees through binders', () => {
    const t = p('λz. (λx. x) z')
    expect(redexes(t).map((r) => r.join('/'))).toEqual(['body'])
  })

  it('counts occurrences bound by a lambda', () => {
    const t = p('(λx. x x) y')
    expect(boundVarOccurrences(t, ['fn']).map((o) => o.join('/'))).toEqual([
      'fn/body/fn',
      'fn/body/arg',
    ])
    // zero occurrences for K's second binder
    const k = DICTIONARY.get('K')!
    expect(boundVarOccurrences(k, ['body'])).toEqual([])
  })
})

describe('strategies', () => {
  it('normal order picks leftmost-outermost', () => {
    const t = p('(λx. y) ((λz. z) w)')
    expect(pickRedex(t, 'normal')).toEqual([])
  })

  it('applicative order picks leftmost-innermost', () => {
    const t = p('(λx. y) ((λz. z) w)')
    expect(pickRedex(t, 'applicative')).toEqual(['arg'])
  })

  it('K x Ω terminates in one step under normal order', () => {
    const t = p('K x Ω')
    const { result, steps, converged } = normalize(t, 'normal')
    expect(converged).toBe(true)
    expect(steps).toBe(2) // K x → λy.x, then (λy.x) Ω → x
    expect(equal(result, p('x'))).toBe(true)
  })

  it('(λx. y) Ω diverges under applicative order', () => {
    const t = p('(λx. y) Ω')
    const { converged } = normalize(t, 'applicative', 50)
    expect(converged).toBe(false)
  })

  it('Ω never converges', () => {
    const { converged, result } = normalize(p('Ω'), 'normal', 100)
    expect(converged).toBe(false)
    expect(equal(result, p('Ω'))).toBe(true) // and every step is Ω again
  })
})

describe('Church arithmetic computes', () => {
  it('PLUS 2 3 normalizes to 5', () => {
    const { result, converged } = normalize(p('PLUS 2 3'))
    expect(converged).toBe(true)
    expect(equal(result, church(5))).toBe(true)
  })

  it('MULT 2 3 normalizes to 6', () => {
    const { result } = normalize(p('MULT 2 3'))
    expect(equal(result, church(6))).toBe(true)
  })

  it('POW 2 3 normalizes to 8', () => {
    const { result } = normalize(p('POW 2 3'))
    expect(equal(result, church(8))).toBe(true)
  })

  it('booleans: AND TRUE FALSE → FALSE', () => {
    const { result } = normalize(p('AND TRUE FALSE'))
    expect(equal(result, DICTIONARY.get('FALSE')!)).toBe(true)
  })

  it('ISZERO 0 → TRUE, ISZERO 2 → FALSE', () => {
    expect(equal(normalize(p('ISZERO 0')).result, DICTIONARY.get('TRUE')!)).toBe(true)
    expect(equal(normalize(p('ISZERO 2')).result, DICTIONARY.get('FALSE')!)).toBe(true)
  })

  it('SKK behaves as identity', () => {
    const { result } = normalize(p('S K K q'))
    expect(equal(result, p('q'))).toBe(true)
  })

  it('step counts are stable (guards against silent evaluator changes)', () => {
    expect(normalize(p('PLUS 2 3')).steps).toMatchInlineSnapshot(`6`)
    expect(normalize(p('POW 2 3')).steps).toMatchInlineSnapshot(`16`)
  })
})

describe('presets', () => {
  it('every gallery preset parses', async () => {
    const { PRESETS } = await import('../ui/presets')
    for (const preset of PRESETS) expect(() => p(preset.src)).not.toThrow()
  })

  it('capture demo: (λx. λy. x) y → λ_. y with the free y intact', () => {
    const { result } = normalize(p('(λx. λy. x) y'))
    expect(equal(result, p('λz. y'))).toBe(true)
  })

  it('NOT TRUE → FALSE', () => {
    const { result } = normalize(p('NOT TRUE'))
    expect(equal(result, DICTIONARY.get('FALSE')!)).toBe(true)
  })

  it('FST (PAIR x y) → x', () => {
    const { result } = normalize(p('FST (PAIR x y)'))
    expect(equal(result, p('x'))).toBe(true)
  })

  it('SUCC 2 → 3', () => {
    const { result } = normalize(p('SUCC 2'))
    expect(equal(result, church(3))).toBe(true)
  })
})
