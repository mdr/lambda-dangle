import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Term, Path } from '../lambda/term'
import { layoutTerm, NodeInfo } from './layout'

// One TermView per displayed term: a flat group of per-node meshes plus
// edges (tree structure) and tethers (variable → binder identity arcs).
// Geometries are shared; materials are per-node so the choreography can
// dim/fade/boost nodes individually.

// -- tubular glyph geometries for the two structural node kinds -------------

function strokeTube(points: [number, number][], r: number, segs = 22): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)))
  return new THREE.TubeGeometry(curve, segs, r, 10, false)
}

function strokeCap(x: number, y: number, r: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, 10, 8).translate(x, y, 0)
}

/** λ as two tubular strokes: the long diagonal (with a little head flag)
 *  and the leg branching from its middle. */
function lambdaGlyphGeometry(): THREE.BufferGeometry {
  const r = 0.095
  const main = strokeTube(
    [
      [-0.36, 0.46],
      [-0.2, 0.5],
      [-0.02, 0.36],
      [0.1, 0.1],
      [0.42, -0.52],
    ],
    r,
  )
  const leg = strokeTube(
    [
      [0.08, 0.06],
      [-0.1, -0.22],
      [-0.42, -0.52],
    ],
    r,
    14,
  )
  return mergeGeometries([
    main,
    leg,
    strokeCap(-0.36, 0.46, r),
    strokeCap(0.42, -0.52, r),
    strokeCap(-0.42, -0.52, r),
  ])!
}

/** @ as a tubular bowl ('a'), its stem, and a 310° outer arc whose gap sits
 *  at the bottom-right where the stem runs out into the tail. */
function atGlyphGeometry(): THREE.BufferGeometry {
  const r = 0.075
  const arc = Math.PI * 1.72
  const bowl = new THREE.TorusGeometry(0.165, r, 10, 28).translate(-0.02, -0.01, 0)
  const outer = new THREE.TorusGeometry(0.42, r, 10, 44, arc)
  const stem = strokeTube(
    [
      [0.15, 0.14],
      [0.165, -0.1],
      [0.42 * Math.cos(arc), 0.42 * Math.sin(arc)],
    ],
    r,
    14,
  )
  return mergeGeometries([
    bowl,
    outer,
    stem,
    strokeCap(0.15, 0.14, r),
    strokeCap(0.42, 0, r),
    strokeCap(0.42 * Math.cos(arc), 0.42 * Math.sin(arc), r),
  ])!
}

const GEO = {
  lam: lambdaGlyphGeometry(),
  app: atGlyphGeometry(),
  vr: new THREE.SphereGeometry(0.28, 24, 16),
  free: new THREE.SphereGeometry(0.3, 24, 16),
  edge: new THREE.CylinderGeometry(0.045, 0.045, 1, 8),
}

// Thin tubes are poor raycast targets — every node gets an invisible sphere
// as its hover/click hit area instead.
const HIT_GEO = new THREE.SphereGeometry(0.52, 8, 6)
const HIT_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

const TETHER_POINTS = 28
const UP = new THREE.Vector3(0, 1, 0)
const tmpDir = new THREE.Vector3()
const tmpMid = new THREE.Vector3()
const tmpPt = new THREE.Vector3()

export interface NodeView {
  info: NodeInfo
  mesh: THREE.Mesh
  /** Invisible, generous raycast target that shadows `mesh`'s position. */
  hit: THREE.Mesh
  material: THREE.MeshStandardMaterial
  baseEmissive: number
  baseOpacity: number
  edge: THREE.Mesh | null
  edgeMaterial: THREE.MeshStandardMaterial | null
  tether: THREE.Line | null
  tetherMaterial: THREE.LineBasicMaterial | null
  label: THREE.Sprite | null
  /** Set while the choreography owns this node's edge/tether transforms. */
  frozen: boolean
}

const labelTextureCache = new Map<string, THREE.Texture>()

function labelTexture(text: string): THREE.Texture {
  let tex = labelTextureCache.get(text)
  if (tex) return tex
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = '600 68px ui-monospace, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 10
  ctx.fillStyle = '#e6ebf7'
  ctx.fillText(text, 128, 66)
  tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  labelTextureCache.set(text, tex)
  return tex
}

function jewel(hue: number): { color: THREE.Color; emissive: THREE.Color } {
  return {
    color: new THREE.Color().setHSL(hue / 360, 0.62, 0.52),
    emissive: new THREE.Color().setHSL(hue / 360, 0.8, 0.34),
  }
}

const NEUTRAL = { color: new THREE.Color('#96a0b8'), emissive: new THREE.Color('#4a5470') }
const FREE = { color: new THREE.Color('#b9c0cf'), emissive: new THREE.Color('#585f70') }

/** Resting emissive of tree edges, and the "ignition" tint the two
 *  structural edges of a redex take when it is highlighted or fires. */
export const EDGE_BASE_EMISSIVE = new THREE.Color('#232a40')
export const EDGE_HOT_EMISSIVE = new THREE.Color('#b7c3ff')

export class TermView {
  readonly group = new THREE.Group()
  readonly nodes = new Map<string, NodeView>()
  readonly redexKeys = new Set<string>()

  constructor(
    readonly term: Term,
    names: ReadonlyMap<string, string>,
    labelsOn: boolean,
  ) {
    const infos = layoutTerm(term)

    for (const info of infos.values()) {
      const isLam = info.kind === 'lam'
      const palette =
        info.hue !== null ? jewel(info.hue) : info.kind === 'free' ? FREE : NEUTRAL
      const baseEmissive = info.isRedex ? 0.55 : isLam || info.kind === 'var' ? 0.4 : 0.28
      const material = new THREE.MeshStandardMaterial({
        color: palette.color,
        emissive: palette.emissive,
        emissiveIntensity: baseEmissive,
        roughness: 0.32,
        metalness: 0.15,
        transparent: true,
        opacity: 1,
      })
      const mesh = new THREE.Mesh(GEO[info.kind === 'var' ? 'vr' : info.kind], material)
      mesh.position.set(info.x, info.y, info.z)
      mesh.userData.key = info.key
      mesh.userData.path = info.path
      this.group.add(mesh)
      if (info.isRedex) this.redexKeys.add(info.key)

      const hit = new THREE.Mesh(HIT_GEO, HIT_MAT)
      hit.position.copy(mesh.position)
      hit.userData.key = info.key
      hit.userData.path = info.path
      this.group.add(hit)

      let edge: THREE.Mesh | null = null
      let edgeMaterial: THREE.MeshStandardMaterial | null = null
      if (info.parentKey !== null) {
        edgeMaterial = new THREE.MeshStandardMaterial({
          color: '#39415a',
          emissive: '#232a40',
          emissiveIntensity: 0.5,
          roughness: 0.6,
          transparent: true,
        })
        edge = new THREE.Mesh(GEO.edge, edgeMaterial)
        this.group.add(edge)
      }

      let tether: THREE.Line | null = null
      let tetherMaterial: THREE.LineBasicMaterial | null = null
      if (info.binderKey !== null && info.hue !== null) {
        tetherMaterial = new THREE.LineBasicMaterial({
          color: new THREE.Color().setHSL(info.hue / 360, 0.9, 0.62),
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
        const geo = new THREE.BufferGeometry()
        geo.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(TETHER_POINTS * 3), 3),
        )
        tether = new THREE.Line(geo, tetherMaterial)
        this.group.add(tether)
      }

      let label: THREE.Sprite | null = null
      const name = names.get(info.key)
      if (name && info.kind !== 'app') {
        const mat = new THREE.SpriteMaterial({
          map: labelTexture(name),
          transparent: true,
          depthWrite: false,
        })
        label = new THREE.Sprite(mat)
        label.scale.set(1.5, 0.75, 1)
        label.visible = labelsOn || info.kind === 'free'
        label.userData.always = info.kind === 'free'
        this.group.add(label)
      }

      this.nodes.set(info.key, {
        info,
        mesh,
        hit,
        material,
        baseEmissive,
        baseOpacity: 1,
        edge,
        edgeMaterial,
        tether,
        tetherMaterial,
        label,
        frozen: false,
      })
    }
    this.updateConnections()
  }

  /** Recompute edge transforms, tether curves and label positions from the
   *  meshes' *current* positions. Called every frame so animation carries
   *  the connective tissue along. */
  updateConnections(): void {
    for (const nv of this.nodes.values()) {
      nv.hit.position.copy(nv.mesh.position)
      if (nv.label) {
        nv.label.position.set(
          nv.mesh.position.x,
          nv.mesh.position.y + 0.68,
          nv.mesh.position.z + 0.15,
        )
      }
      if (nv.frozen) continue
      if (nv.edge && nv.info.parentKey !== null) {
        const parent = this.nodes.get(nv.info.parentKey)
        if (parent) {
          tmpDir.subVectors(nv.mesh.position, parent.mesh.position)
          const len = Math.max(tmpDir.length(), 0.0001)
          tmpMid.addVectors(parent.mesh.position, nv.mesh.position).multiplyScalar(0.5)
          nv.edge.position.copy(tmpMid)
          nv.edge.quaternion.setFromUnitVectors(UP, tmpDir.normalize())
          nv.edge.scale.set(1, len, 1)
        }
      }
      if (nv.tether && nv.info.binderKey !== null) {
        const binder = this.nodes.get(nv.info.binderKey)
        if (binder) {
          const a = nv.mesh.position
          const b = binder.mesh.position
          const dist = a.distanceTo(b)
          // control point pushed away from the camera so tethers arc through
          // depth BEHIND the tree instead of crossing in front of it
          tmpMid.addVectors(a, b).multiplyScalar(0.5)
          tmpMid.z -= 1.1 + dist * 0.22
          const attr = nv.tether.geometry.getAttribute('position') as THREE.BufferAttribute
          for (let i = 0; i < TETHER_POINTS; i++) {
            const t = i / (TETHER_POINTS - 1)
            // quadratic bezier
            tmpPt.set(0, 0, 0)
            tmpPt.addScaledVector(a, (1 - t) * (1 - t))
            tmpPt.addScaledVector(tmpMid, 2 * (1 - t) * t)
            tmpPt.addScaledVector(b, t * t)
            attr.setXYZ(i, tmpPt.x, tmpPt.y, tmpPt.z)
          }
          attr.needsUpdate = true
        }
      }
    }
  }

  setLabelsVisible(on: boolean): void {
    for (const nv of this.nodes.values()) {
      if (nv.label) nv.label.visible = on || nv.label.userData.always === true
    }
  }

  setTethersVisible(on: boolean): void {
    for (const nv of this.nodes.values()) {
      if (nv.tether) nv.tether.visible = on
    }
  }

  setHighlight(key: string, on: boolean): void {
    const nv = this.nodes.get(key)
    if (!nv) return
    nv.mesh.scale.setScalar(on ? 1.2 : 1)
    nv.material.emissiveIntensity = on ? nv.baseEmissive + 0.9 : nv.baseEmissive
    if (nv.tetherMaterial) nv.tetherMaterial.opacity = on ? 1 : 0.55
  }

  /** Highlight a redex as a UNIT — the application node and its lambda,
   *  joined by their hot edge. The same shape phase 2 of the choreography
   *  flashes, so hover and firing agree. */
  setRedexHighlight(key: string, on: boolean): void {
    const appNv = this.nodes.get(key)
    if (!appNv || appNv.info.kind !== 'app') {
      this.setHighlight(key, on)
      return
    }
    const lamNv = this.nodes.get((key === '' ? '' : key + '/') + 'fn')
    for (const nv of [appNv, lamNv]) {
      if (!nv) continue
      nv.mesh.scale.setScalar(on ? (nv === appNv ? 1.2 : 1.12) : 1)
      nv.material.emissiveIntensity = on
        ? nv.baseEmissive + (nv === appNv ? 0.9 : 0.55)
        : nv.baseEmissive
    }
    if (lamNv?.edgeMaterial) {
      lamNv.edgeMaterial.emissive.copy(on ? EDGE_HOT_EMISSIVE : EDGE_BASE_EMISSIVE)
      lamNv.edgeMaterial.emissiveIntensity = on ? 1.6 : 0.5
    }
  }

  /** Hit targets eligible for redex clicking. */
  redexMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = []
    for (const key of this.redexKeys) {
      const nv = this.nodes.get(key)
      if (nv) out.push(nv.hit)
    }
    return out
  }

  allMeshes(): THREE.Mesh[] {
    return [...this.nodes.values()].map((nv) => nv.hit)
  }

  keysUnder(prefixKey: string): string[] {
    const out: string[] = []
    for (const key of this.nodes.keys()) {
      if (prefixKey === '' || key === prefixKey || key.startsWith(prefixKey + '/')) out.push(key)
    }
    return out
  }

  boundsOf(keysIn: Iterable<string>): { center: THREE.Vector3; radius: number } {
    const keys = [...keysIn]
    const center = new THREE.Vector3()
    let n = 0
    for (const k of keys) {
      const nv = this.nodes.get(k)
      if (nv) {
        center.add(nv.mesh.position)
        n++
      }
    }
    if (n === 0) return { center, radius: 5 }
    center.multiplyScalar(1 / n)
    let radius = 0
    for (const k of keys) {
      const nv = this.nodes.get(k)
      if (nv) radius = Math.max(radius, center.distanceTo(nv.mesh.position))
    }
    return { center, radius: radius + 2 }
  }

  bounds(): { center: THREE.Vector3; radius: number } {
    return this.boundsOf(this.nodes.keys())
  }

  dispose(): void {
    for (const nv of this.nodes.values()) {
      nv.material.dispose()
      nv.edgeMaterial?.dispose()
      nv.tetherMaterial?.dispose()
      nv.tether?.geometry.dispose()
      if (nv.label) (nv.label.material as THREE.SpriteMaterial).dispose()
    }
    this.group.removeFromParent()
  }
}

export function pathOfMesh(mesh: THREE.Object3D): Path {
  return mesh.userData.path as Path
}
