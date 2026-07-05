import { Term, Path, pathKey } from './term'

// Pretty-printing for the text panel and the label overlay. Since the engine
// is de Bruijn, display names are assigned here: a binder keeps its `hint`
// when possible and gets primed (x → x′ → x″ …) on collision with an
// enclosing binder or a free variable.

export interface Span {
  path: string // pathKey
  start: number
  end: number
}

export interface Printed {
  text: string
  spans: Span[]
}

const FRESH = 'abcdefghijklmnopqrstuvw'

function collectFreeNames(t: Term, out: Set<string>): void {
  switch (t.kind) {
    case 'free':
      out.add(t.name)
      return
    case 'var':
      return
    case 'lam':
      collectFreeNames(t.body, out)
      return
    case 'app':
      collectFreeNames(t.fn, out)
      collectFreeNames(t.arg, out)
      return
  }
}

function uniquify(base: string, taken: ReadonlySet<string>): string {
  let name = base
  while (taken.has(name)) name += '′'
  return name
}

/**
 * Display name for every lam and var node (vars show their binder's name,
 * free vars their own), keyed by pathKey.
 */
export function assignNames(t: Term): Map<string, string> {
  const names = new Map<string, string>()
  const freeNames = new Set<string>()
  collectFreeNames(t, freeNames)
  let freshIdx = 0

  const walk = (n: Term, path: Path, env: string[]): void => {
    switch (n.kind) {
      case 'var': {
        const name = env[n.index] ?? `?${n.index}`
        names.set(pathKey(path), name)
        return
      }
      case 'free':
        names.set(pathKey(path), n.name)
        return
      case 'lam': {
        const taken = new Set([...env, ...freeNames])
        let base = n.hint
        if (!base) {
          base = FRESH[freshIdx % FRESH.length] + '′'.repeat(Math.floor(freshIdx / FRESH.length))
          freshIdx++
        }
        const name = uniquify(base, taken)
        names.set(pathKey(path), name)
        walk(n.body, [...path, 'body'], [name, ...env])
        return
      }
      case 'app':
        walk(n.fn, [...path, 'fn'], env)
        walk(n.arg, [...path, 'arg'], env)
        return
    }
  }
  walk(t, [], [])
  return names
}

/** Pretty-print with standard precedence, recording a span for every node. */
export function prettyPrint(t: Term): Printed {
  const names = assignNames(t)
  const spans: Span[] = []
  let text = ''

  const emit = (s: string): void => {
    text += s
  }

  // ctx 'fn': parens around lambdas; ctx 'arg': parens around lambdas + apps
  const print = (n: Term, path: Path, ctx: 'top' | 'fn' | 'arg'): void => {
    const start = text.length
    switch (n.kind) {
      case 'var':
      case 'free':
        emit(names.get(pathKey(path))!)
        break
      case 'lam': {
        const parens = ctx !== 'top'
        if (parens) emit('(')
        emit(`λ${names.get(pathKey(path))!}. `)
        print(n.body, [...path, 'body'], 'top')
        if (parens) emit(')')
        break
      }
      case 'app': {
        const parens = ctx === 'arg'
        if (parens) emit('(')
        print(n.fn, [...path, 'fn'], 'fn')
        emit(' ')
        print(n.arg, [...path, 'arg'], 'arg')
        if (parens) emit(')')
        break
      }
    }
    spans.push({ path: pathKey(path), start, end: text.length })
  }

  print(t, [], 'top')
  return { text, spans }
}

export const pretty = (t: Term): string => prettyPrint(t).text
