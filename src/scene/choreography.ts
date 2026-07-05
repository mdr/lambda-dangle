import * as THREE from 'three'
import { Term, Path, pathKey, boundVarOccurrences } from '../lambda/term'
import { Animator, easeInOut, easeOut, linear } from './tween'
import { TermView, NodeView, EDGE_BASE_EMISSIVE, EDGE_HOT_EMISSIVE } from './view'

// The five-phase beta choreography:
//   1 focus     — redex lifts toward camera, everything else dims
//   2 identify  — the binder ring and its variables/tethers pulse
//   3 copy&fly  — argument copies fan out and fly the tether arcs
//                 (or the argument evaporates when unused)
//   4 merge     — copies land; the lambda and application node collapse
//   5 settle    — the tree tweens to its new tidy layout

const D = {
  focus: 0.5,
  identifyTrio: 0.5,
  identify: 0.6,
  identifyArg: 0.45,
  fly: 0.95,
  stagger: 0.13,
  merge: 0.4,
  settle: 0.85,
}

export interface ChoreoCtx {
  animator: Animator
  oldView: TermView
  oldTerm: Term
  redexPath: Path
  newTerm: Term
  /** Build (and add to the scene) the view for the new term. */
  buildView: (term: Term) => TermView
  /** Remove an arbitrary object added during the choreography. */
  sceneAdd: (obj: THREE.Object3D) => void
  sceneRemove: (obj: THREE.Object3D) => void
  /** Ease the camera to frame a bounding sphere (no-op if auto-cam off). */
  frame: (center: THREE.Vector3, radius: number) => void
  /** Compute settle source positions for the new view. */
  sources: (oldPositions: ReadonlyMap<string, THREE.Vector3>) => Map<string, THREE.Vector3>
}

export async function animateBeta(ctx: ChoreoCtx): Promise<TermView> {
  const { animator, oldView, oldTerm, redexPath } = ctx
  const redexKey = pathKey(redexPath)
  const lamPath: Path = [...redexPath, 'fn']
  const lamKey = pathKey(lamPath)
  const argKey = pathKey([...redexPath, 'arg'])

  const redexKeys = new Set(oldView.keysUnder(redexKey))
  const argKeys = oldView.keysUnder(argKey)
  const occurrences = boundVarOccurrences(oldTerm, lamPath).map(pathKey)

  // ---- phase 1: focus -------------------------------------------------
  {
    const dims: { m: THREE.Material & { opacity: number }; from: number; to: number }[] = []
    for (const [key, nv] of oldView.nodes) {
      if (!redexKeys.has(key)) {
        dims.push({ m: nv.material, from: nv.material.opacity, to: 0.15 })
        if (nv.edgeMaterial) dims.push({ m: nv.edgeMaterial, from: nv.edgeMaterial.opacity, to: 0.15 })
        if (nv.tetherMaterial) dims.push({ m: nv.tetherMaterial, from: nv.tetherMaterial.opacity, to: 0.1 })
      }
    }
    const lifts: { mesh: THREE.Mesh; from: number; to: number }[] = []
    for (const key of redexKeys) {
      const nv = oldView.nodes.get(key)!
      lifts.push({ mesh: nv.mesh, from: nv.mesh.position.z, to: nv.mesh.position.z + 1.1 })
    }
    const b = oldView.boundsOf(redexKeys)
    ctx.frame(b.center.clone().add(new THREE.Vector3(0, 0, 1)), b.radius)
    await animator.tween(D.focus, (k) => {
      for (const d of dims) d.m.opacity = d.from + (d.to - d.from) * k
      for (const l of lifts) l.mesh.position.z = l.from + (l.to - l.from) * k
    })
  }

  // ---- phase 2: identify ----------------------------------------------
  // Beat A: the redex is the application-of-a-lambda — @ node and λ ring
  // flash as one unit, joined by their hot edge.
  {
    const pair = [redexKey, lamKey]
      .map((k) => oldView.nodes.get(k))
      .filter((nv): nv is NodeView => nv !== undefined)
    const lamNv = oldView.nodes.get(lamKey)
    await animator.tween(D.identifyTrio, (k) => {
      const s = Math.sin(k * Math.PI)
      for (const nv of pair) {
        nv.mesh.scale.setScalar(1 + 0.3 * s)
        nv.material.emissiveIntensity = nv.baseEmissive + 1.1 * s
      }
      if (lamNv?.edgeMaterial) {
        lamNv.edgeMaterial.emissiveIntensity = 0.5 + 2.4 * s
        lamNv.edgeMaterial.emissive.lerpColors(EDGE_BASE_EMISSIVE, EDGE_HOT_EMISSIVE, s)
      }
    })
    for (const nv of pair) nv.mesh.scale.setScalar(1)
  }

  // Beat B: the binder and the holes its argument will fill.
  {
    const lamNv = oldView.nodes.get(lamKey)
    const pulseTargets: NodeView[] = []
    if (lamNv) pulseTargets.push(lamNv)
    for (const oKey of occurrences) {
      const nv = oldView.nodes.get(oKey)
      if (nv) pulseTargets.push(nv)
    }
    await animator.tween(D.identify, (k) => {
      const s = 1 + 0.4 * Math.sin(k * Math.PI * 2) * (k < 1 ? 1 : 0)
      for (const nv of pulseTargets) {
        nv.mesh.scale.setScalar(Math.max(0.6, s))
        nv.material.emissiveIntensity = nv.baseEmissive + 0.9 * Math.sin(k * Math.PI)
        if (nv.tetherMaterial) nv.tetherMaterial.opacity = 0.55 + 0.45 * Math.sin(k * Math.PI)
      }
    })
    for (const nv of pulseTargets) nv.mesh.scale.setScalar(1)
  }

  // Beat C: the argument subtree about to be substituted flashes as a whole.
  {
    const argNvs = oldView
      .keysUnder(argKey)
      .map((k) => oldView.nodes.get(k))
      .filter((nv): nv is NodeView => nv !== undefined)
    await animator.tween(D.identifyArg, (k) => {
      const s = Math.sin(k * Math.PI)
      for (const nv of argNvs) {
        nv.mesh.scale.setScalar(1 + 0.22 * s)
        nv.material.emissiveIntensity = nv.baseEmissive + 1.0 * s
        // internal edges glow with it; the root's edge is its link to the
        // application node, which is not part of what travels
        if (nv.edgeMaterial && nv.info.key !== argKey) {
          nv.edgeMaterial.emissiveIntensity = 0.5 + 1.4 * s
        }
      }
    })
    for (const nv of argNvs) nv.mesh.scale.setScalar(1)
  }

  // ---- phase 3: copy & fly ---------------------------------------------
  const proxies: THREE.Group[] = []
  {
    const argNodes = argKeys.map((k) => oldView.nodes.get(k)!).filter(Boolean)
    const centroid = new THREE.Vector3()
    for (const nv of argNodes) centroid.add(nv.mesh.position)
    centroid.multiplyScalar(1 / Math.max(1, argNodes.length))

    if (occurrences.length === 0) {
      // unused argument: it simply evaporates
      const parts = argNodes.map((nv) => ({
        nv,
        fromPos: nv.mesh.position.clone(),
        fromScale: nv.mesh.scale.x,
      }))
      for (const nv of argNodes) {
        nv.frozen = true
        nv.material.depthWrite = false
        if (nv.edgeMaterial) nv.edgeMaterial.depthWrite = false
      }
      await animator.tween(D.fly * 0.8, (k) => {
        for (const p of parts) {
          p.nv.mesh.position.lerpVectors(p.fromPos, centroid, k)
          p.nv.mesh.scale.setScalar(p.fromScale * (1 - k) + 0.01 * k)
          p.nv.material.opacity = 1 - k
          if (p.nv.edgeMaterial) p.nv.edgeMaterial.opacity = (1 - k) * 0.9
          if (p.nv.tetherMaterial) p.nv.tetherMaterial.opacity = (1 - k) * 0.5
          if (p.nv.edge) p.nv.edge.scale.multiplyScalar(0.96)
          if (p.nv.label) p.nv.label.visible = false
        }
      }, easeInOut)
    } else {
      // one flying copy per occurrence, fanning out from the original.
      // The proxy is anchored at the argument's ROOT node so the root — not
      // the subtree's centroid — lands exactly on the variable it replaces.
      const anchor = (oldView.nodes.get(argKey)?.mesh.position ?? centroid).clone()
      const flights: Promise<void>[] = []
      occurrences.forEach((oKey, i) => {
        const target = oldView.nodes.get(oKey)!
        const proxy = new THREE.Group()
        for (const nv of argNodes) {
          const m = nv.mesh.clone()
          m.material = nv.material.clone()
          m.position.copy(nv.mesh.position).sub(anchor)
          proxy.add(m)
          // the subtree root's edge is its link to the application node —
          // that relationship doesn't travel with the copy
          if (nv.edge && nv.info.key !== argKey) {
            const e = nv.edge.clone()
            e.material = nv.edgeMaterial!.clone()
            e.position.sub(anchor)
            proxy.add(e)
          }
        }
        proxy.position.copy(anchor)
        ctx.sceneAdd(proxy)
        proxies.push(proxy)

        const from = anchor.clone()
        const to = target.mesh.position.clone()
        const mid = from.clone().add(to).multiplyScalar(0.5)
        mid.z += 2.4
        // fan copies apart so the duplication moment reads clearly
        const fan = (i - (occurrences.length - 1) / 2) * 1.1
        mid.x += fan
        mid.y += 0.6
        const pt = new THREE.Vector3()
        flights.push(
          (async () => {
            await animator.delay(i * D.stagger)
            await animator.tween(D.fly, (k) => {
              pt.set(0, 0, 0)
              pt.addScaledVector(from, (1 - k) * (1 - k))
              pt.addScaledVector(mid, 2 * (1 - k) * k)
              pt.addScaledVector(to, k * k)
              proxy.position.copy(pt)
            }, easeInOut)
            // the variable sphere it lands on dissolves: luminous while its
            // alpha drops (not dimming to black), shrinking as if absorbed,
            // with depth-write off so it never silhouettes what's behind
            target.material.depthWrite = false
            await animator.tween(0.22, (k) => {
              target.material.opacity = 1 - k
              target.material.emissiveIntensity = target.baseEmissive * (1 + 0.8 * k)
              target.mesh.scale.setScalar(1 - 0.55 * k)
              if (target.tetherMaterial) target.tetherMaterial.opacity = (1 - k) * 0.5
              if (target.label) target.label.visible = false
            })
          })(),
        )
      })
      // the original argument fades once its copies are away
      const fade = (async () => {
        await animator.delay(D.fly * 0.55)
        for (const nv of argNodes) {
          nv.frozen = true
          nv.material.depthWrite = false
          if (nv.edgeMaterial) nv.edgeMaterial.depthWrite = false
        }
        await animator.tween(0.3, (k) => {
          for (const nv of argNodes) {
            nv.material.opacity = 1 - k
            if (nv.edgeMaterial) nv.edgeMaterial.opacity = (1 - k) * 0.9
            if (nv.tetherMaterial) nv.tetherMaterial.opacity = (1 - k) * 0.5
            if (nv.label) nv.label.visible = false
          }
        })
      })()
      await Promise.all([...flights, fade])
    }
  }

  // ---- phase 4: merge ---------------------------------------------------
  {
    const collapse: NodeView[] = []
    const lamNv = oldView.nodes.get(lamKey)
    const appNv = oldView.nodes.get(redexKey)
    if (lamNv) collapse.push(lamNv)
    if (appNv) collapse.push(appNv)
    for (const nv of collapse) {
      nv.frozen = true
      nv.material.depthWrite = false
      if (nv.edgeMaterial) nv.edgeMaterial.depthWrite = false
    }
    await animator.tween(D.merge, (k) => {
      for (const nv of collapse) {
        nv.mesh.scale.setScalar(Math.max(0.01, 1 - k))
        nv.material.opacity = 1 - k
        if (nv.edgeMaterial) nv.edgeMaterial.opacity = (1 - k) * 0.9
        if (nv.edge) nv.edge.scale.setScalar(Math.max(0.01, 1 - k))
      }
    }, easeOut)
  }

  // ---- phase 5: settle ----------------------------------------------------
  {
    const oldPositions = new Map<string, THREE.Vector3>()
    for (const [key, nv] of oldView.nodes) oldPositions.set(key, nv.mesh.position.clone())
    const sources = ctx.sources(oldPositions)

    const newView = ctx.buildView(ctx.newTerm)
    // swap: old view and proxies out, new view (parked at sources) in
    oldView.dispose()
    for (const p of proxies) ctx.sceneRemove(p)

    const inRedex = (key: string): boolean =>
      redexKey === '' || key === redexKey || key.startsWith(redexKey + '/')

    // Alignment: translate the new layout so SURVIVING nodes move as little
    // as possible — global drift goes to the camera (a pan), not the nodes.
    const offset = new THREE.Vector3()
    let aligned = 0
    for (const [key, nv] of newView.nodes) {
      const src = sources.get(key)
      if (src && !inRedex(key)) {
        offset.add(nv.mesh.position).sub(src)
        aligned++
      }
    }
    if (aligned === 0) {
      // whole term was the redex: align on whatever has a source
      for (const [key, nv] of newView.nodes) {
        const src = sources.get(key)
        if (src) {
          offset.add(nv.mesh.position).sub(src)
          aligned++
        }
      }
    }
    if (aligned > 0) offset.multiplyScalar(1 / aligned)

    // Ripple: each node's tween starts later the further it is (in tree
    // steps) from the substitution site, so the change visibly propagates
    // outward. Previously-dimmed regions fade back up as the ripple reaches
    // them instead of snapping.
    interface Move {
      nv: NodeView
      from: THREE.Vector3
      to: THREE.Vector3
      delay: number
      dim: boolean
    }
    const moves: Move[] = []
    let maxDelay = 0
    for (const [key, nv] of newView.nodes) {
      const to = nv.mesh.position.clone().sub(offset)
      const from = (sources.get(key) ?? to).clone()
      const delay = Math.min(0.4, treeDistance(nv.info.path, ctx.redexPath) * 0.045)
      maxDelay = Math.max(maxDelay, delay)
      const dim = !inRedex(key)
      if (dim) {
        nv.material.opacity = 0.15
        if (nv.edgeMaterial) nv.edgeMaterial.opacity = 0.15
        if (nv.tetherMaterial) nv.tetherMaterial.opacity = 0.1
      }
      nv.mesh.position.copy(from)
      moves.push({ nv, from, to, delay, dim })
    }
    newView.updateConnections()

    const center = new THREE.Vector3()
    for (const mv of moves) center.add(mv.to)
    center.multiplyScalar(1 / Math.max(1, moves.length))
    let radius = 0
    for (const mv of moves) radius = Math.max(radius, center.distanceTo(mv.to))
    ctx.frame(center, radius + 2)

    const total = D.settle + maxDelay
    await animator.tween(
      total,
      (k) => {
        const t = k * total
        for (const mv of moves) {
          const p = Math.min(1, Math.max(0, (t - mv.delay) / D.settle))
          const e = easeInOut(p)
          mv.nv.mesh.position.lerpVectors(mv.from, mv.to, e)
          if (mv.dim) {
            mv.nv.material.opacity = 0.15 + 0.85 * e
            if (mv.nv.edgeMaterial) mv.nv.edgeMaterial.opacity = 0.15 + 0.85 * e
            if (mv.nv.tetherMaterial) mv.nv.tetherMaterial.opacity = 0.1 + 0.45 * e
          }
        }
        newView.updateConnections()
      },
      linear,
    )
    return newView
  }
}

/** Steps between two tree paths (up to the common ancestor, then down). */
function treeDistance(a: Path, b: Path): number {
  let c = 0
  while (c < a.length && c < b.length && a[c] === b[c]) c++
  return a.length + b.length - 2 * c
}
