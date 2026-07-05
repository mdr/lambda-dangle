import { Term } from './term'
import { parse } from './parser'

// The built-in cast of combinators, usable by name in typed input and
// expanded to their (closed) terms at parse time. Later entries may
// reference earlier ones.
const DEFS: [string, string][] = [
  ['I', 'λx. x'],
  ['K', 'λx y. x'],
  ['S', 'λx y z. x z (y z)'],
  ['TRUE', 'λt f. t'],
  ['FALSE', 'λt f. f'],
  ['AND', 'λp q. p q p'],
  ['OR', 'λp q. p p q'],
  ['NOT', 'λp. λa b. p b a'],
  ['PAIR', 'λa b. λs. s a b'],
  ['FST', 'λp. p TRUE'],
  ['SND', 'λp. p FALSE'],
  ['SUCC', 'λn. λf x. f (n f x)'],
  ['PLUS', 'λm n. λf x. m f (n f x)'],
  ['MULT', 'λm n. λf. m (n f)'],
  ['POW', 'λm n. n m'],
  ['ISZERO', 'λn. n (λx. FALSE) TRUE'],
  ['Y', 'λf. (λx. f (x x)) (λx. f (x x))'],
  ['Ω', '(λx. x x) (λx. x x)'],
]

function build(): Map<string, Term> {
  const dict = new Map<string, Term>()
  for (const [name, src] of DEFS) dict.set(name, parse(src, dict))
  // ASCII alias for Ω
  dict.set('OMEGA', dict.get('Ω')!)
  return dict
}

export const DICTIONARY: ReadonlyMap<string, Term> = build()

export function parseWithDict(src: string): Term {
  return parse(src, DICTIONARY)
}
