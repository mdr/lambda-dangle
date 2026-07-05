import * as THREE from 'three'
import { Term, Path, getAt, childAt, pathKey } from '../lambda/term'

// After a beta step, every node of the NEW term is given a source position
// in the OLD scene so the settle phase can tween from visual continuity:
//  - nodes outside the redex kept their paths → their old positions
//  - nodes from the lambda body → the matching old body node's position
//  - nodes of a substituted argument copy → the variable site it landed on
// (Structure outside the redex is unchanged by beta, so those paths exist.)

export function settleSources(
  oldTerm: Term,
  redexPath: Path,
  oldPositions: ReadonlyMap<string, THREE.Vector3>,
  newTerm: Term,
): Map<string, THREE.Vector3> {
  const sources = new Map<string, THREE.Vector3>()
  const redexKey = pathKey(redexPath)
  const bodyBase: Path = [...redexPath, 'fn', 'body']
  const oldBody = getAt(oldTerm, bodyBase)

  const argBase: Path = [...redexPath, 'arg']
  const argRootPos = oldPositions.get(pathKey(argBase))

  const sourceForBody = (q: Path): THREE.Vector3 | undefined => {
    let node = oldBody
    let depth = 0
    const rel: Path = []
    for (let i = 0; ; i++) {
      if (node.kind === 'var' && node.index === depth) {
        // a substitution site: the copy landed here as a rigid shape, root
        // on the variable — each copy node starts at the variable position
        // plus its offset within the argument subtree
        const varPos = oldPositions.get(pathKey([...bodyBase, ...rel]))
        const argNodePos = oldPositions.get(pathKey([...argBase, ...q.slice(i)]))
        if (varPos && argNodePos && argRootPos) {
          return varPos.clone().add(argNodePos).sub(argRootPos)
        }
        return varPos
      }
      if (i >= q.length) break
      const step = q[i]
      if (node.kind === 'lam' && step === 'body') depth++
      node = childAt(node, step)
      rel.push(step)
    }
    return oldPositions.get(pathKey([...bodyBase, ...rel]))
  }

  const walk = (t: Term, path: Path): void => {
    const key = pathKey(path)
    let src: THREE.Vector3 | undefined
    if (key === redexKey || key.startsWith(redexKey === '' ? '' : redexKey + '/')) {
      const q = path.slice(redexPath.length)
      src = sourceForBody(q)
    } else {
      src = oldPositions.get(key)
    }
    if (src) sources.set(key, src.clone())
    switch (t.kind) {
      case 'lam':
        walk(t.body, [...path, 'body'])
        return
      case 'app':
        walk(t.fn, [...path, 'fn'])
        walk(t.arg, [...path, 'arg'])
        return
      default:
        return
    }
  }
  walk(newTerm, [])
  return sources
}
