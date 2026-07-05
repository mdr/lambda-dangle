import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { VRButton } from 'three/addons/webxr/VRButton.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Path } from '../lambda/term'
import { TermView, pathOfMesh } from './view'
import { Animator } from './tween'

export class SceneManager {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly controls: OrbitControls
  private readonly composer: EffectComposer

  currentView: TermView | null = null
  autoFrame = true
  onRedexClick: ((path: Path) => void) | null = null
  onHoverNode: ((key: string | null) => void) | null = null
  onXRAction: ((action: 'step' | 'back' | 'reset' | 'run') => void) | null = null

  /** User-transformable container (VR: scaled to tabletop, rotatable). */
  private worldGroup = new THREE.Group()
  /** Inner container for views + proxies; auto-recentered while in VR. */
  private contentGroup = new THREE.Group()
  private grid: THREE.GridHelper
  private controllers: THREE.Object3D[] = []
  private prevButtons = new Map<string, boolean[]>()
  private recenterTarget = new THREE.Vector3()

  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2(-10, -10)
  private hoveredRedexKey: string | null = null
  private hoveredAnyKey: string | null = null
  private userInteracting = false
  private clock = new THREE.Clock()

  constructor(
    canvas: HTMLCanvasElement,
    private animator: Animator,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
    this.camera.position.set(0, 0, 18)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.scene.background = new THREE.Color('#06070c')

    this.worldGroup.add(this.contentGroup)
    this.scene.add(this.worldGroup)

    // ---- WebXR --------------------------------------------------------
    this.renderer.xr.enabled = true
    const vrBtn = VRButton.createButton(this.renderer)
    vrBtn.style.left = 'auto'
    vrBtn.style.right = '16px'
    vrBtn.style.bottom = '16px'
    document.body.appendChild(vrBtn)

    this.grid = new THREE.GridHelper(8, 32, 0x2a3252, 0x12172b)
    this.grid.visible = false
    this.scene.add(this.grid)

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i)
      const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ])
      const ray = new THREE.Line(
        rayGeo,
        new THREE.LineBasicMaterial({
          color: '#8f9dff',
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      ray.scale.z = 4
      controller.add(ray)
      controller.addEventListener('selectstart', () => this.xrSelect())
      this.scene.add(controller)
      this.controllers.push(controller)
    }

    this.renderer.xr.addEventListener('sessionstart', () => this.enterXR())
    this.renderer.xr.addEventListener('sessionend', () => this.exitXR())

    this.scene.add(new THREE.AmbientLight('#8090b8', 0.7))
    const key = new THREE.DirectionalLight('#ffffff', 1.6)
    key.position.set(6, 10, 8)
    this.scene.add(key)
    const fill = new THREE.PointLight('#7fa0ff', 60, 0, 1.8)
    fill.position.set(-10, -6, 12)
    this.scene.add(fill)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.55)
    this.composer.addPass(bloom)
    this.composer.addPass(new OutputPass())

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.addEventListener('start', () => (this.userInteracting = true))
    this.controls.addEventListener('end', () => (this.userInteracting = false))

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect()
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    })
    canvas.addEventListener('click', () => {
      if (this.hoveredRedexKey !== null && this.currentView && this.onRedexClick) {
        const nv = this.currentView.nodes.get(this.hoveredRedexKey)
        if (nv) this.onRedexClick(pathOfMesh(nv.mesh))
      }
    })

    const resize = (): void => {
      if (this.renderer.xr.isPresenting) return
      const w = canvas.clientWidth || window.innerWidth
      const h = canvas.clientHeight || window.innerHeight
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h, false)
      this.composer.setSize(w, h)
    }
    window.addEventListener('resize', resize)
    resize()

    this.renderer.setAnimationLoop(() => this.tick())
  }

  setView(view: TermView | null): void {
    this.currentView = view
    if (view && !view.group.parent) this.contentGroup.add(view.group)
    this.hoveredRedexKey = null
    this.hoveredAnyKey = null
  }

  add(obj: THREE.Object3D): void {
    this.contentGroup.add(obj)
  }

  remove(obj: THREE.Object3D): void {
    this.contentGroup.remove(obj)
  }

  /** Ease the camera to frame a bounding sphere, keeping its direction.
   *  Skipped while the user is dragging, in VR, or with auto-framing off. */
  frame(center: THREE.Vector3, radius: number): void {
    if (this.renderer.xr.isPresenting) return
    if (!this.autoFrame || this.userInteracting) return
    const vFov = (this.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    const fovRad = Math.min(vFov, hFov)
    const dist = Math.max(6, (radius / Math.sin(fovRad / 2)) * 1.12)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    const fromTarget = this.controls.target.clone()
    const fromPos = this.camera.position.clone()
    const toTarget = center.clone()
    const toPos = center.clone().addScaledVector(dir, dist)
    void this.animator.tween(0.6, (k) => {
      this.controls.target.lerpVectors(fromTarget, toTarget, k)
      this.camera.position.lerpVectors(fromPos, toPos, k)
    })
  }

  frameCurrent(): void {
    if (!this.currentView) return
    const b = this.currentView.bounds()
    this.frame(b.center, b.radius)
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const presenting = this.renderer.xr.isPresenting
    this.animator.update(dt)
    if (!presenting) this.controls.update()

    const view = this.currentView
    if (view) {
      view.updateConnections()
      if (presenting) this.xrPick(view)
      else this.pick(view)
      // redexes breathe
      const t = this.clock.elapsedTime
      let i = 0
      for (const key of view.redexKeys) {
        const nv = view.nodes.get(key)
        if (nv && key !== this.hoveredRedexKey) {
          nv.material.emissiveIntensity =
            nv.baseEmissive + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.6 + i * 1.7))
        }
        i++
      }
      if (presenting) {
        // no camera framing in VR — instead gently keep the term centered
        // in its tabletop container
        const b = view.bounds()
        this.recenterTarget.copy(b.center).negate()
        this.contentGroup.position.lerp(this.recenterTarget, 0.03)
      }
    }

    if (presenting) {
      this.pollGamepads(dt)
      // EffectComposer (bloom) doesn't support XR's per-eye rendering
      this.renderer.render(this.scene, this.camera)
    } else {
      this.composer.render()
    }
  }

  // ---- WebXR session & input --------------------------------------------

  private enterXR(): void {
    const radius = this.currentView?.bounds().radius ?? 8
    this.worldGroup.scale.setScalar(Math.min(0.1, 0.55 / radius))
    this.worldGroup.position.set(0, 1.35, -1.1)
    this.worldGroup.rotation.set(0, 0, 0)
    this.grid.visible = true
  }

  private exitXR(): void {
    this.worldGroup.scale.setScalar(1)
    this.worldGroup.position.set(0, 0, 0)
    this.worldGroup.rotation.set(0, 0, 0)
    this.contentGroup.position.set(0, 0, 0)
    this.grid.visible = false
  }

  private xrPick(view: TermView): void {
    const m = new THREE.Matrix4()
    let found: string | null = null
    for (const controller of this.controllers) {
      m.identity().extractRotation(controller.matrixWorld)
      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m)
      const hits = this.raycaster.intersectObjects(view.redexMeshes(), false)
      if (hits.length > 0) {
        found = hits[0].object.userData.key as string
        break
      }
    }
    if (found !== this.hoveredRedexKey) {
      if (this.hoveredRedexKey !== null) view.setRedexHighlight(this.hoveredRedexKey, false)
      if (found !== null) view.setRedexHighlight(found, true)
      this.hoveredRedexKey = found
    }
  }

  private xrSelect(): void {
    if (this.hoveredRedexKey !== null && this.currentView && this.onRedexClick) {
      const nv = this.currentView.nodes.get(this.hoveredRedexKey)
      if (nv) this.onRedexClick(pathOfMesh(nv.mesh))
    }
  }

  /** Quest controllers (xr-standard mapping): right A/B = step/back,
   *  left X/Y = reset/run, right thumbstick rotates and scales the term. */
  private pollGamepads(dt: number): void {
    const session = this.renderer.xr.getSession()
    if (!session) return
    for (const src of Array.from(session.inputSources)) {
      const gp = src.gamepad
      if (!gp || !src.handedness || src.handedness === 'none') continue
      const prev = this.prevButtons.get(src.handedness) ?? []
      const pressed = gp.buttons.map((b) => b.pressed)
      const edge = (i: number): boolean => pressed[i] === true && prev[i] !== true
      if (src.handedness === 'right') {
        if (edge(4)) this.onXRAction?.('step')
        if (edge(5)) this.onXRAction?.('back')
        const ax = gp.axes[2] ?? 0
        const ay = gp.axes[3] ?? 0
        if (Math.abs(ax) > 0.15) this.worldGroup.rotation.y -= ax * dt * 1.8
        if (Math.abs(ay) > 0.15) {
          const s = THREE.MathUtils.clamp(this.worldGroup.scale.x * (1 - ay * dt), 0.008, 0.6)
          this.worldGroup.scale.setScalar(s)
        }
      } else {
        if (edge(4)) this.onXRAction?.('reset')
        if (edge(5)) this.onXRAction?.('run')
      }
      this.prevButtons.set(src.handedness, pressed)
    }
  }

  private pick(view: TermView): void {
    this.raycaster.setFromCamera(this.pointer, this.camera)

    const redexHits = this.raycaster.intersectObjects(view.redexMeshes(), false)
    const newRedexKey = redexHits.length > 0 ? (redexHits[0].object.userData.key as string) : null
    if (newRedexKey !== this.hoveredRedexKey) {
      if (this.hoveredRedexKey !== null) view.setRedexHighlight(this.hoveredRedexKey, false)
      if (newRedexKey !== null) view.setRedexHighlight(newRedexKey, true)
      this.hoveredRedexKey = newRedexKey
      this.renderer.domElement.style.cursor = newRedexKey !== null ? 'pointer' : 'grab'
    }

    const anyHits = this.raycaster.intersectObjects(view.allMeshes(), false)
    const newAnyKey = anyHits.length > 0 ? (anyHits[0].object.userData.key as string) : null
    if (newAnyKey !== this.hoveredAnyKey) {
      this.hoveredAnyKey = newAnyKey
      this.onHoverNode?.(newAnyKey)
    }
  }
}
