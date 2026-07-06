export interface Preset {
  name: string
  src: string
  caption: string
}

export const PRESETS: Preset[] = [
  { name: 'I x', src: 'I x', caption: 'The simplest possible step — identity hands its argument back.' },
  { name: 'K x y', src: 'K x y', caption: 'Watch an argument get discarded: y simply evaporates.' },
  { name: '(λx. x x) y', src: '(λx. x x) y', caption: 'Duplication: one argument, two landing sites.' },
  { name: '(λx. λy. x) y', src: '(λx. λy. x) y', caption: 'Capture avoided: the free y must not be caught by the inner binder.' },
  { name: 'S K K x', src: 'S K K x', caption: 'Identity rebuilt from S and K — combinators all the way down.' },
  { name: 'AND TRUE FALSE', src: 'AND TRUE FALSE', caption: 'Booleans are functions; the truth table computes itself.' },
  { name: 'NOT TRUE', src: 'NOT TRUE', caption: 'One application flips the truth table.' },
  { name: 'FST (PAIR x y)', src: 'FST (PAIR x y)', caption: 'A pair is a function holding two values; FST asks it for the first.' },
  { name: 'SUCC 2', src: 'SUCC 2', caption: 'Adding one: the numeral grows by a single application.' },
  { name: 'PLUS 2 3', src: 'PLUS 2 3', caption: 'Arithmetic blooms through Church encodings.' },
  { name: 'MULT 2 3', src: 'MULT 2 3', caption: 'Multiplication composes the counting functions.' },
  { name: 'POW 2 3', src: 'POW 2 3', caption: 'Duplication compounds — watch the tree get big.' },
  { name: '(λx. y) Ω', src: '(λx. y) Ω', caption: 'Strategy matters: normal order survives, applicative diverges.' },
  { name: 'Ω', src: 'Ω', caption: 'The term that never finishes — every step returns to itself.' },
  { name: 'Y f', src: 'Y f', caption: 'Recursion unfolding, one turn of the crank at a time.' },
]

/** Index of the preset loaded on startup. */
export const DEFAULT_PRESET = PRESETS.findIndex((p) => p.name === 'PLUS 2 3')
