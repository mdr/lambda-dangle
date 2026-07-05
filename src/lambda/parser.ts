import { Term, vr, fr, lam, app } from './term'

// Syntax: `λ` or `\` for binders, application by juxtaposition
// (left-associative), parens to group, multi-binder sugar `λx y. …`,
// bodies extend as far right as possible. A lambda may appear unparenthesized
// as the final atom of an application. Decimal literals expand to Church
// numerals at parse time. Names resolve to de Bruijn indices; unbound names
// that match a dictionary entry expand to that (closed) term; anything else
// becomes a free variable.

interface Token {
  type: 'lambda' | 'dot' | 'lparen' | 'rparen' | 'ident' | 'number'
  text: string
  pos: number
}

export class ParseError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message)
  }
}

const isSpace = (c: string) => /\s/.test(c)
const isDigit = (c: string) => c >= '0' && c <= '9'
const isIdentChar = (c: string) =>
  !isSpace(c) && !'λ\\.()'.includes(c) && !isDigit(c)
const isIdentContinue = (c: string) => !isSpace(c) && !'λ\\.()'.includes(c)

function tokenize(src: string): Token[] {
  const toks: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (isSpace(c)) {
      i++
      continue
    }
    if (c === 'λ' || c === '\\') {
      toks.push({ type: 'lambda', text: c, pos: i })
      i++
    } else if (c === '.') {
      toks.push({ type: 'dot', text: c, pos: i })
      i++
    } else if (c === '(') {
      toks.push({ type: 'lparen', text: c, pos: i })
      i++
    } else if (c === ')') {
      toks.push({ type: 'rparen', text: c, pos: i })
      i++
    } else if (isDigit(c)) {
      let j = i
      while (j < src.length && isDigit(src[j])) j++
      toks.push({ type: 'number', text: src.slice(i, j), pos: i })
      i = j
    } else if (isIdentChar(c)) {
      let j = i + 1
      while (j < src.length && isIdentContinue(src[j])) j++
      toks.push({ type: 'ident', text: src.slice(i, j), pos: i })
      i = j
    } else {
      throw new ParseError(`unexpected character '${c}'`, i)
    }
  }
  return toks
}

/** Church numeral: λf. λx. f (f … (f x)). */
export function church(n: number): Term {
  let body: Term = vr(0)
  for (let i = 0; i < n; i++) body = app(vr(1), body)
  return lam('f', lam('x', body))
}

export function parse(src: string, dictionary: ReadonlyMap<string, Term> = new Map()): Term {
  const toks = tokenize(src)
  let pos = 0

  const peek = (): Token | null => (pos < toks.length ? toks[pos] : null)
  const next = (): Token => {
    const t = peek()
    if (!t) throw new ParseError('unexpected end of input', src.length)
    pos++
    return t
  }
  const expect = (type: Token['type'], what: string): Token => {
    const t = peek()
    if (!t || t.type !== type)
      throw new ParseError(`expected ${what}${t ? `, got '${t.text}'` : ' but input ended'}`, t?.pos ?? src.length)
    return next()
  }

  // ctx: innermost binder first
  function parseTerm(ctx: string[]): Term {
    const t = peek()
    if (t && t.type === 'lambda') return parseLambda(ctx)
    return parseAppSeq(ctx)
  }

  function parseLambda(ctx: string[]): Term {
    expect('lambda', 'λ')
    const names: string[] = []
    while (peek()?.type === 'ident') names.push(next().text)
    if (names.length === 0)
      throw new ParseError('expected at least one variable name after λ', peek()?.pos ?? src.length)
    expect('dot', "'.'")
    const body = parseTerm([...names.slice().reverse(), ...ctx])
    return names.reduceRight((acc, name) => lam(name, acc), body)
  }

  function parseAppSeq(ctx: string[]): Term {
    let result: Term | null = null
    for (;;) {
      const t = peek()
      if (!t || t.type === 'rparen' || t.type === 'dot') break
      let atom: Term
      if (t.type === 'lambda') {
        // trailing unparenthesized lambda swallows the rest
        atom = parseLambda(ctx)
      } else {
        atom = parseAtom(ctx)
      }
      result = result === null ? atom : app(result, atom)
      if (t.type === 'lambda') break
    }
    if (result === null)
      throw new ParseError('expected a term', peek()?.pos ?? src.length)
    return result
  }

  function parseAtom(ctx: string[]): Term {
    const t = next()
    switch (t.type) {
      case 'lparen': {
        const inner = parseTerm(ctx)
        expect('rparen', "')'")
        return inner
      }
      case 'number':
        return church(parseInt(t.text, 10))
      case 'ident': {
        const idx = ctx.indexOf(t.text)
        if (idx >= 0) return vr(idx)
        const dict = dictionary.get(t.text)
        if (dict) return dict // closed term: safe to splice in as-is
        return fr(t.text)
      }
      default:
        throw new ParseError(`unexpected '${t.text}'`, t.pos)
    }
  }

  const result = parseTerm([])
  const trailing = peek()
  if (trailing) throw new ParseError(`unexpected '${trailing.text}' after term`, trailing.pos)
  return result
}
