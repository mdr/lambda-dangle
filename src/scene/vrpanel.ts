import * as THREE from 'three'
import { PRESETS } from '../ui/presets'

// In-VR control palette: a canvas-textured button board attached to the
// left controller, clicked with the other controller's ray. Hidden by
// default to keep pure VR mode uncluttered; left X toggles it.

interface ButtonDef {
  id: string
  label: string
  w: number
}

const BTN_H = 0.034
const GAP = 0.007
const PANEL_W = 0.3

interface Button {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  canvas: HTMLCanvasElement
  tex: THREE.CanvasTexture
}

export class VRPanel {
  readonly group = new THREE.Group()
  private buttons = new Map<string, Button>()
  private hoveredId: string | null = null

  constructor() {
    const rows: ButtonDef[][] = [
      [
        { id: 'step', label: '▶ step', w: 0.136 },
        { id: 'back', label: '◀ back', w: 0.136 },
      ],
      [
        { id: 'run', label: '⏵ run', w: 0.136 },
        { id: 'reset', label: '⏮ reset', w: 0.136 },
      ],
      [
        { id: 'scale:-', label: '⊖ smaller', w: 0.136 },
        { id: 'scale:+', label: '⊕ bigger', w: 0.136 },
      ],
      [{ id: 'strategy', label: 'strategy: normal', w: 0.279 }],
      ...pairs(PRESETS.map((p, i) => ({ id: `preset:${i}`, label: p.name, w: 0.136 }))),
    ]

    const totalH = rows.length * (BTN_H + GAP) + GAP + 0.012
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, totalH),
      new THREE.MeshBasicMaterial({
        color: '#0b0e1a',
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
      }),
    )
    backing.position.z = -0.002
    this.group.add(backing)

    let y = totalH / 2 - GAP - BTN_H / 2
    for (const row of rows) {
      const rowW = row.reduce((s, b) => s + b.w, 0) + GAP * (row.length - 1)
      let x = -rowW / 2
      for (const def of row) {
        this.addButton(def, x + def.w / 2, y)
        x += def.w + GAP
      }
      y -= BTN_H + GAP
    }
    this.group.visible = false
  }

  private addButton(def: ButtonDef, x: number, y: number): void {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(560 * (def.w / 0.279))
    canvas.height = 68
    drawButton(canvas, def.label)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    // DoubleSide so the selecting ray can hit the tilted board from any
    // approach angle (FrontSide planes are invisible to back-face raycasts)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.w, BTN_H), mat)
    mesh.position.set(x, y, 0)
    mesh.userData.buttonId = def.id
    this.group.add(mesh)
    this.buttons.set(def.id, { mesh, mat, canvas, tex })
  }

  setLabel(id: string, label: string): void {
    const b = this.buttons.get(id)
    if (!b) return
    drawButton(b.canvas, label)
    b.tex.needsUpdate = true
  }

  toggle(): boolean {
    this.group.visible = !this.group.visible
    if (!this.group.visible) this.setHover(null)
    return this.group.visible
  }

  /** Raycast the panel's buttons; pure — hover is set separately so several
   *  controllers can be tested before committing a single hover state. */
  hitTest(raycaster: THREE.Raycaster): string | null {
    if (!this.group.visible) return null
    const meshes = [...this.buttons.values()].map((b) => b.mesh)
    const hits = raycaster.intersectObjects(meshes, false)
    return hits.length > 0 ? (hits[0].object.userData.buttonId as string) : null
  }

  setHover(id: string | null): void {
    if (id === this.hoveredId) return
    if (this.hoveredId !== null) this.buttons.get(this.hoveredId)?.mat.color.set('#ffffff')
    if (id !== null) this.buttons.get(id)?.mat.color.set('#8f9dff')
    this.hoveredId = id
  }

  flash(id: string): void {
    const b = this.buttons.get(id)
    if (!b) return
    b.mat.color.set('#c9d3ff')
    setTimeout(() => b.mat.color.set(id === this.hoveredId ? '#8f9dff' : '#ffffff'), 160)
  }
}

/** Chunk buttons into rows of two (presets read as a compact grid). */
function pairs(defs: ButtonDef[]): ButtonDef[][] {
  const rows: ButtonDef[][] = []
  for (let i = 0; i < defs.length; i += 2) rows.push(defs.slice(i, i + 2))
  return rows
}

function drawButton(canvas: HTMLCanvasElement, label: string): void {
  const g = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  g.clearRect(0, 0, w, h)
  const r = 14
  g.beginPath()
  g.moveTo(r, 1)
  g.arcTo(w - 1, 1, w - 1, h - 1, r)
  g.arcTo(w - 1, h - 1, 1, h - 1, r)
  g.arcTo(1, h - 1, 1, 1, r)
  g.arcTo(1, 1, w - 1, 1, r)
  g.closePath()
  g.fillStyle = 'rgba(32, 38, 64, 0.95)'
  g.fill()
  g.strokeStyle = 'rgba(130, 148, 210, 0.45)'
  g.lineWidth = 2
  g.stroke()
  g.fillStyle = '#dfe5f2'
  // shrink to fit: long names (AND TRUE FALSE) share rows with short ones
  let size = 30
  g.font = `600 ${size}px ui-monospace, Menlo, monospace`
  while (size > 14 && g.measureText(label).width > w - 20) {
    size -= 2
    g.font = `600 ${size}px ui-monospace, Menlo, monospace`
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, w / 2, h / 2 + 1)
}
