// Core term representation: de Bruijn indices. `hint` on a lambda is the
// name the user originally wrote, kept only for the optional label overlay.

export type Term =
  | { kind: 'var'; index: number }
  | { kind: 'free'; name: string }
  | { kind: 'lam'; hint: string | null; body: Term }
  | { kind: 'app'; fn: Term; arg: Term }

export type PathStep = 'body' | 'fn' | 'arg'
export type Path = PathStep[]

export const vr = (index: number): Term => ({ kind: 'var', index })
export const fr = (name: string): Term => ({ kind: 'free', name })
export const lam = (hint: string | null, body: Term): Term => ({ kind: 'lam', hint, body })
export const app = (fn: Term, arg: Term): Term => ({ kind: 'app', fn, arg })

export const pathKey = (p: Path): string => p.join('/')

export function childAt(t: Term, step: PathStep): Term {
  if (t.kind === 'lam' && step === 'body') return t.body
  if (t.kind === 'app' && step === 'fn') return t.fn
  if (t.kind === 'app' && step === 'arg') return t.arg
  throw new Error(`no child '${step}' on ${t.kind}`)
}

export function getAt(t: Term, path: Path): Term {
  let cur = t
  for (const s of path) cur = childAt(cur, s)
  return cur
}

export function replaceAt(t: Term, path: Path, sub: Term): Term {
  if (path.length === 0) return sub
  const [s, ...rest] = path
  if (t.kind === 'lam' && s === 'body') return lam(t.hint, replaceAt(t.body, rest, sub))
  if (t.kind === 'app' && s === 'fn') return app(replaceAt(t.fn, rest, sub), t.arg)
  if (t.kind === 'app' && s === 'arg') return app(t.fn, replaceAt(t.arg, rest, sub))
  throw new Error(`bad path step '${s}' on ${t.kind}`)
}

/** Shift free indices >= cutoff by d. */
export function shift(t: Term, d: number, cutoff = 0): Term {
  switch (t.kind) {
    case 'var':
      return t.index >= cutoff ? vr(t.index + d) : t
    case 'free':
      return t
    case 'lam':
      return lam(t.hint, shift(t.body, d, cutoff + 1))
    case 'app':
      return app(shift(t.fn, d, cutoff), shift(t.arg, d, cutoff))
  }
}

/** Capture-free substitution [j := s]t (s is shifted as we descend). */
export function subst(t: Term, j: number, s: Term): Term {
  switch (t.kind) {
    case 'var':
      return t.index === j ? s : t
    case 'free':
      return t
    case 'lam':
      return lam(t.hint, subst(t.body, j + 1, shift(s, 1)))
    case 'app':
      return app(subst(t.fn, j, s), subst(t.arg, j, s))
  }
}

export function isRedex(t: Term): boolean {
  return t.kind === 'app' && t.fn.kind === 'lam'
}

/** Perform the beta step at `path` (which must point at a redex). */
export function betaReduceAt(root: Term, path: Path): Term {
  const t = getAt(root, path)
  if (t.kind !== 'app' || t.fn.kind !== 'lam') throw new Error('not a redex')
  const result = shift(subst(t.fn.body, 0, shift(t.arg, 1)), -1)
  return replaceAt(root, path, result)
}

/** Structural equality, ignoring binder hints (i.e. alpha-equivalence). */
export function equal(a: Term, b: Term): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'var':
      return a.index === (b as typeof a).index
    case 'free':
      return a.name === (b as typeof a).name
    case 'lam':
      return equal(a.body, (b as typeof a).body)
    case 'app':
      return equal(a.fn, (b as typeof a).fn) && equal(a.arg, (b as typeof a).arg)
  }
}

export function nodeCount(t: Term): number {
  switch (t.kind) {
    case 'var':
    case 'free':
      return 1
    case 'lam':
      return 1 + nodeCount(t.body)
    case 'app':
      return 1 + nodeCount(t.fn) + nodeCount(t.arg)
  }
}

/**
 * Absolute paths of every variable occurrence bound by the lambda at
 * `lamPath`. Used by the choreography to know where argument copies fly.
 */
export function boundVarOccurrences(root: Term, lamPath: Path): Path[] {
  const lamNode = getAt(root, lamPath)
  if (lamNode.kind !== 'lam') throw new Error('not a lambda')
  const out: Path[] = []
  const walk = (t: Term, depth: number, rel: Path): void => {
    switch (t.kind) {
      case 'var':
        if (t.index === depth) out.push([...lamPath, 'body', ...rel])
        return
      case 'free':
        return
      case 'lam':
        walk(t.body, depth + 1, [...rel, 'body'])
        return
      case 'app':
        walk(t.fn, depth, [...rel, 'fn'])
        walk(t.arg, depth, [...rel, 'arg'])
        return
    }
  }
  walk(lamNode.body, 0, [])
  return out
}
