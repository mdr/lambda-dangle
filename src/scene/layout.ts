import { Term, Path, PathStep, pathKey } from '../lambda/term'
import { redexes } from '../lambda/reduce'

// Hybrid layout: a deterministic 2D tidy tree in the XY plane, with the
// z-axis carrying emphasis (redexes lift toward the camera; the choreography
// lifts the active substitution further). Leaves are assigned successive
// x slots; interior nodes sit at the mean of their children; y is -depth.

export const DX = 1.7
export const DY = 1.55
export const Z_REDEX = 0.8

export type NodeKind = 'lam' | 'app' | 'var' | 'free'

export interface NodeInfo {
  path: Path
  key: string
  kind: NodeKind
  depth: number
  x: number
  y: number
  z: number
  parentKey: string | null
  /** For bound vars: pathKey of the binding lambda. */
  binderKey: string | null
  /** Jewel hue in degrees for lams and their bound vars; null = neutral. */
  hue: number | null
  /** For app nodes: is this a redex in the current term? */
  isRedex: boolean
}

const GOLDEN = 137.508

export function layoutTerm(term: Term): Map<string, NodeInfo> {
  const infos = new Map<string, NodeInfo>()
  const redexSet = new Set(redexes(term).map(pathKey))

  let leafSlot = 0
  let lamCount = 0

  // binderStack: pathKeys+hues of enclosing lams, innermost last
  const walk = (
    t: Term,
    path: Path,
    depth: number,
    parentKey: string | null,
    binders: { key: string; hue: number }[],
  ): number => {
    const key = pathKey(path)
    const base = { path, key, depth, parentKey, y: -depth * DY, z: 0, binderKey: null, hue: null, isRedex: false }
    switch (t.kind) {
      case 'var': {
        const b = binders[binders.length - 1 - t.index]
        const x = leafSlot++ * DX
        infos.set(key, { ...base, kind: 'var', x, binderKey: b?.key ?? null, hue: b?.hue ?? null })
        return x
      }
      case 'free': {
        const x = leafSlot++ * DX
        infos.set(key, { ...base, kind: 'free', x })
        return x
      }
      case 'lam': {
        const hue = (lamCount++ * GOLDEN) % 360
        const x = walk(t.body, [...path, 'body'], depth + 1, key, [...binders, { key, hue }])
        infos.set(key, { ...base, kind: 'lam', x, hue })
        return x
      }
      case 'app': {
        const xf = walk(t.fn, [...path, 'fn'], depth + 1, key, binders)
        const xa = walk(t.arg, [...path, 'arg'], depth + 1, key, binders)
        const x = (xf + xa) / 2
        infos.set(key, {
          ...base,
          kind: 'app',
          x,
          z: redexSet.has(key) ? Z_REDEX : 0,
          isRedex: redexSet.has(key),
        })
        return x
      }
    }
  }
  walk(term, [], 0, null, [])

  // center the bounding box on the origin
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of infos.values()) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x)
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  for (const n of infos.values()) {
    n.x -= cx
    n.y -= cy
  }
  return infos
}

export function isUnder(key: string, prefix: string): boolean {
  if (prefix === '') return true
  return key === prefix || key.startsWith(prefix + '/')
}

export function stepInto(path: Path, step: PathStep): Path {
  return [...path, step]
}
