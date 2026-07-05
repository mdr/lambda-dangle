export interface Preset {
  name: string
  src: string
  caption: string
}

export const PRESETS: Preset[] = [
  { name: 'I x', src: 'I x', caption: 'The simplest possible step — identity hands its argument back.' },
  { name: 'K x y', src: 'K x y', caption: 'Watch an argument get discarded: y simply evaporates.' },
  { name: '(λx. x x) y', src: '(λx. x x) y', caption: 'Duplication: one argument, two landing sites.' },
  { name: 'AND TRUE FALSE', src: 'AND TRUE FALSE', caption: 'Booleans are functions; the truth table computes itself.' },
  { name: 'PLUS 2 3', src: 'PLUS 2 3', caption: 'Arithmetic blooms through Church encodings.' },
  { name: 'POW 2 3', src: 'POW 2 3', caption: 'Duplication compounds — watch the tree get big.' },
  { name: '(λx. y) Ω', src: '(λx. y) Ω', caption: 'Strategy matters: normal order survives, applicative diverges.' },
  { name: 'Ω', src: 'Ω', caption: 'The term that never finishes — every step returns to itself.' },
  { name: 'Y f', src: 'Y f', caption: 'Recursion unfolding, one turn of the crank at a time.' },
]
