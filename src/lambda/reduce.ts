import { Term, Path, isRedex, betaReduceAt } from './term'

/**
 * All redex paths, in leftmost-outermost order (pre-order, node before
 * children, fn before arg). The first element is the normal-order redex.
 */
export function redexes(t: Term): Path[] {
  const out: Path[] = []
  const walk = (n: Term, path: Path): void => {
    if (isRedex(n)) out.push(path)
    switch (n.kind) {
      case 'lam':
        walk(n.body, [...path, 'body'])
        return
      case 'app':
        walk(n.fn, [...path, 'fn'])
        walk(n.arg, [...path, 'arg'])
        return
      default:
        return
    }
  }
  walk(t, [])
  return out
}

export type Strategy = 'normal' | 'applicative'

/** The redex the given strategy would fire next, or null in normal form. */
export function pickRedex(t: Term, strategy: Strategy): Path | null {
  if (strategy === 'normal') {
    const rs = redexes(t)
    return rs.length > 0 ? rs[0] : null
  }
  // Applicative: leftmost-innermost — first redex in post-order (fn subtree,
  // then arg subtree, then the node itself).
  let found: Path | null = null
  const walk = (n: Term, path: Path): boolean => {
    switch (n.kind) {
      case 'lam':
        if (walk(n.body, [...path, 'body'])) return true
        break
      case 'app':
        if (walk(n.fn, [...path, 'fn'])) return true
        if (walk(n.arg, [...path, 'arg'])) return true
        break
      default:
        break
    }
    if (isRedex(n)) {
      found = path
      return true
    }
    return false
  }
  walk(t, [])
  return found
}

export interface NormalizeResult {
  result: Term
  steps: number
  converged: boolean
}

/** Repeatedly beta-reduce under `strategy`, giving up after `fuel` steps. */
export function normalize(t: Term, strategy: Strategy = 'normal', fuel = 1000): NormalizeResult {
  let cur = t
  for (let steps = 0; steps < fuel; steps++) {
    const r = pickRedex(cur, strategy)
    if (r === null) return { result: cur, steps, converged: true }
    cur = betaReduceAt(cur, r)
  }
  return { result: cur, steps: fuel, converged: false }
}
