import './style.css'
import { Term, Path, pathKey, betaReduceAt, nodeCount } from './lambda/term'
import { redexes, pickRedex, Strategy } from './lambda/reduce'
import { parseWithDict } from './lambda/dict'
import { ParseError } from './lambda/parser'
import { assignNames, prettyPrint } from './lambda/pretty'
import { PRESETS } from './ui/presets'
import { Animator } from './scene/tween'
import { SceneManager } from './scene/scene'
import { TermView } from './scene/view'
import { animateBeta } from './scene/choreography'
import { settleSources } from './scene/correspond'
import { audio, ambient } from './audio'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const NODE_WARN_THRESHOLD = 2500
const RUN_STEP_CAP = 1000

class App {
  private animator = new Animator()
  private sceneMgr = new SceneManager($<HTMLCanvasElement>('scene'), this.animator)

  private history: Term[] = []
  private pos = 0
  private labelsOn = false
  private tethersOn = true
  private running = false
  private pending: Promise<void> = Promise.resolve()
  private animating = false

  private strategySelect = $<HTMLSelectElement>('strategy')
  private stepCounter = $('step-counter')
  private nodeBadge = $('node-badge')
  private termText = $('term-text')
  private messageEl = $('message')
  private runBtn = $<HTMLButtonElement>('btn-run')

  constructor() {
    this.wireUi()
    this.loadSource(PRESETS[4].src) // PLUS 2 3 — the best first impression
    this.markActivePreset(4)
    // debug/testing handle
    ;(window as unknown as Record<string, unknown>).__lambdaDangle = {
      sceneMgr: this.sceneMgr,
      audio,
    }
  }

  private get current(): Term {
    return this.history[this.pos]
  }

  private get strategy(): Strategy {
    return this.strategySelect.value as Strategy
  }

  // ---- term lifecycle ---------------------------------------------------

  private loadSource(src: string): boolean {
    const errEl = $('parse-error')
    try {
      const term = parseWithDict(src)
      errEl.hidden = true
      this.stopRun()
      this.history = [term]
      this.pos = 0
      this.showTerm(term)
      this.sceneMgr.frameCurrent()
      this.setMessage(null)
      return true
    } catch (e) {
      if (e instanceof ParseError) {
        errEl.textContent = `parse error at ${e.pos}: ${e.message}`
      } else {
        errEl.textContent = String(e)
      }
      errEl.hidden = false
      return false
    }
  }

  private buildView(term: Term): TermView {
    const view = new TermView(term, assignNames(term), this.labelsOn)
    view.setTethersVisible(this.tethersOn)
    this.sceneMgr.add(view.group)
    return view
  }

  /** Instant (unanimated) display of a term. */
  private showTerm(term: Term): void {
    this.sceneMgr.currentView?.dispose()
    this.sceneMgr.setView(this.buildView(term))
    this.updateHud()
  }

  // ---- reduction ----------------------------------------------------------

  private reduceAt(path: Path, animated: boolean): void {
    if (this.pos < this.history.length - 1) {
      this.history = this.history.slice(0, this.pos + 1) // branch: drop the future
    }
    const oldTerm = this.current
    const newTerm = betaReduceAt(oldTerm, path)
    this.history.push(newTerm)
    this.pos++

    if (!animated || this.animator.instant) {
      this.showTerm(newTerm)
      this.sceneMgr.frameCurrent()
      return
    }

    const oldView = this.sceneMgr.currentView!
    this.animating = true
    this.sceneMgr.sparklesSuppressed = true
    audio.duck(true) // ambient bed dips under the choreography
    this.pending = this.pending.then(async () => {
      const newView = await animateBeta({
        animator: this.animator,
        oldView,
        oldTerm,
        redexPath: path,
        newTerm,
        buildView: (t) => this.buildView(t),
        sceneAdd: (o) => this.sceneMgr.add(o),
        sceneRemove: (o) => this.sceneMgr.remove(o),
        frame: (c, r) => this.sceneMgr.frame(c, r),
        sources: (oldPositions) => settleSources(oldTerm, path, oldPositions, newTerm),
      })
      this.sceneMgr.setView(newView)
      this.animator.endSkip()
      this.animating = false
      this.sceneMgr.sparklesSuppressed = this.running
      audio.duck(false) // slow recovery; consecutive run steps re-duck fast
      this.updateHud()
    })
  }

  /** A user action that supersedes a playing animation skips it first. */
  private interrupt(): Promise<void> {
    if (this.animating) this.animator.skip()
    return this.pending
  }

  private async step(): Promise<void> {
    await this.interrupt()
    const r = pickRedex(this.current, this.strategy)
    if (r) this.reduceAt(r, true)
  }

  private async runToNormalForm(): Promise<void> {
    if (this.running) {
      this.stopRun()
      return
    }
    await this.interrupt()
    this.running = true
    this.sceneMgr.sparklesSuppressed = true
    this.runBtn.classList.add('running')
    this.runBtn.textContent = '⏸ stop'
    this.setMessage(null)
    let steps = 0
    while (this.running && steps < RUN_STEP_CAP) {
      const r = pickRedex(this.current, this.strategy)
      if (!r) break
      if (this.animator.instant) {
        this.reduceAt(r, false)
        steps++
        // watchable at first, then hurry — divergent terms shouldn't take
        // minutes to reach the step cap
        await sleep(steps < 40 ? 150 : steps < 200 ? 40 : 8)
      } else {
        // full choreography per step; instant can be toggled mid-run
        this.reduceAt(r, true)
        steps++
        await this.pending
        await sleep(150)
      }
    }
    if (steps >= RUN_STEP_CAP) {
      this.setMessage(`gave up after ${RUN_STEP_CAP} steps — this term is likely divergent`)
    }
    this.stopRun()
  }

  private stopRun(): void {
    this.running = false
    this.sceneMgr.sparklesSuppressed = this.animating
    this.runBtn.classList.remove('running')
    this.runBtn.textContent = '⏵ run'
  }

  private async back(): Promise<void> {
    this.stopRun()
    await this.interrupt()
    if (this.pos > 0) {
      this.pos--
      this.showTerm(this.current)
      this.sceneMgr.frameCurrent()
    }
  }

  private async reset(): Promise<void> {
    this.stopRun()
    await this.interrupt()
    this.pos = 0
    this.showTerm(this.current)
    this.sceneMgr.frameCurrent()
    this.setMessage(null)
  }

  // ---- hud -----------------------------------------------------------------

  private updateHud(): void {
    const term = this.current
    const nRedexes = redexes(term).length
    this.stepCounter.textContent =
      `step ${this.pos}` + (nRedexes > 0 ? ` · ${nRedexes} redex${nRedexes === 1 ? '' : 'es'}` : ' · normal form ✓')

    const n = nodeCount(term)
    this.nodeBadge.textContent = `${n} nodes`
    this.nodeBadge.classList.toggle('warn', n > NODE_WARN_THRESHOLD)
    if (n > NODE_WARN_THRESHOLD) {
      this.setMessage('this term is getting large — animations may get slow')
    }

    $<HTMLButtonElement>('btn-back').disabled = this.pos === 0
    $<HTMLButtonElement>('btn-reset').disabled = this.pos === 0
    $<HTMLButtonElement>('btn-step').disabled = nRedexes === 0
    this.runBtn.disabled = nRedexes === 0 && !this.running

    this.renderTermText(term)
  }

  private renderTermText(term: Term): void {
    const { text, spans } = prettyPrint(term)
    this.termText.textContent = ''
    // Build nested spans: sort by start asc, end desc so parents come first.
    const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
    const root = document.createDocumentFragment()
    const stack: { end: number; el: Node }[] = [{ end: text.length, el: root }]
    let cursor = 0
    for (const s of sorted) {
      while (stack.length > 1 && s.start >= stack[stack.length - 1].end) {
        const done = stack.pop()!
        const top = stack[stack.length - 1]
        if (cursor < done.end) {
          done.el.appendChild(document.createTextNode(text.slice(cursor, done.end)))
          cursor = done.end
        }
        top.el.appendChild(done.el as HTMLElement)
      }
      const parent = stack[stack.length - 1]
      if (cursor < s.start) {
        parent.el.appendChild(document.createTextNode(text.slice(cursor, s.start)))
        cursor = s.start
      }
      const el = document.createElement('span')
      el.className = 'node-span'
      el.dataset.path = s.path
      stack.push({ end: s.end, el })
    }
    while (stack.length > 1) {
      const done = stack.pop()!
      const top = stack[stack.length - 1]
      if (cursor < done.end) {
        done.el.appendChild(document.createTextNode(text.slice(cursor, done.end)))
        cursor = done.end
      }
      top.el.appendChild(done.el as HTMLElement)
    }
    if (cursor < text.length) root.appendChild(document.createTextNode(text.slice(cursor)))
    this.termText.appendChild(root)

    // text → scene hover sync
    this.termText.querySelectorAll<HTMLElement>('.node-span').forEach((el) => {
      el.addEventListener('mouseenter', (e) => {
        e.stopPropagation()
        this.highlightSpan(el.dataset.path ?? null)
        this.sceneMgr.currentView?.setHighlight(el.dataset.path ?? '', true)
      })
      el.addEventListener('mouseleave', () => {
        this.highlightSpan(null)
        this.sceneMgr.currentView?.setHighlight(el.dataset.path ?? '', false)
      })
    })
  }

  private highlightSpan(path: string | null): void {
    this.termText.querySelectorAll('.node-span.hl').forEach((el) => el.classList.remove('hl'))
    if (path !== null) {
      const el = this.termText.querySelector(`.node-span[data-path="${CSS.escape(path)}"]`)
      el?.classList.add('hl')
    }
  }

  private setMessage(msg: string | null): void {
    this.messageEl.hidden = msg === null
    if (msg !== null) this.messageEl.textContent = msg
  }

  private markActivePreset(idx: number | null): void {
    document.querySelectorAll('.preset').forEach((el, i) => {
      el.classList.toggle('active', i === idx)
    })
  }

  // ---- wiring ------------------------------------------------------------

  private wireUi(): void {
    // presets
    const presetsEl = $('presets')
    PRESETS.forEach((p, i) => {
      const btn = document.createElement('button')
      btn.className = 'preset'
      btn.innerHTML = `<span class="p-name"></span><span class="p-caption"></span>`
      btn.querySelector('.p-name')!.textContent = p.name
      btn.querySelector('.p-caption')!.textContent = p.caption
      btn.addEventListener('click', () => {
        void this.interrupt().then(() => {
          $<HTMLTextAreaElement>('term-input').value = p.src
          if (this.loadSource(p.src)) this.markActivePreset(i)
        })
      })
      presetsEl.appendChild(btn)
    })

    // term input
    const input = $<HTMLTextAreaElement>('term-input')
    const load = (): void => {
      void this.interrupt().then(() => {
        if (this.loadSource(input.value)) this.markActivePreset(null)
      })
    }
    $('load-btn').addEventListener('click', load)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        load()
      }
    })

    // transport
    $('btn-step').addEventListener('click', () => void this.step())
    $('btn-back').addEventListener('click', () => void this.back())
    $('btn-reset').addEventListener('click', () => void this.reset())
    this.runBtn.addEventListener('click', () => void this.runToNormalForm())

    const speed = $<HTMLInputElement>('speed')
    speed.addEventListener('input', () => {
      this.animator.speed = parseFloat(speed.value)
    })
    const instant = $<HTMLInputElement>('instant-toggle')
    instant.addEventListener('change', () => {
      this.animator.instant = instant.checked
    })

    // toggles
    const sound = $<HTMLInputElement>('sound-toggle')
    const startAudio = (): void => {
      if (!sound.checked) return
      audio.enable()
      ambient.start()
    }
    sound.addEventListener('change', () => {
      // the change event is a user gesture, so the AudioContext may start
      if (sound.checked) {
        startAudio()
      } else {
        ambient.stop()
        audio.disable()
      }
    })
    // sound is on by default, but browsers gate audio behind the first user
    // gesture — arm it now (the context wakes once a gesture lands) and
    // nudge it again on the first interaction of any kind
    startAudio()
    const firstGesture = (): void => {
      startAudio()
      window.removeEventListener('pointerdown', firstGesture)
      window.removeEventListener('keydown', firstGesture)
    }
    window.addEventListener('pointerdown', firstGesture)
    window.addEventListener('keydown', firstGesture)
    const labels = $<HTMLInputElement>('labels-toggle')
    labels.addEventListener('change', () => {
      this.labelsOn = labels.checked
      this.sceneMgr.currentView?.setLabelsVisible(this.labelsOn)
    })
    const tethers = $<HTMLInputElement>('tethers-toggle')
    tethers.addEventListener('change', () => {
      this.tethersOn = tethers.checked
      this.sceneMgr.currentView?.setTethersVisible(this.tethersOn)
    })
    const autocam = $<HTMLInputElement>('autocam-toggle')
    autocam.addEventListener('change', () => {
      this.sceneMgr.autoFrame = autocam.checked
    })

    // panel collapse
    const panel = $('left-panel')
    const toggle = $('panel-toggle')
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed')
      toggle.classList.toggle('collapsed', collapsed)
      toggle.textContent = collapsed ? '▸' : '◂'
    })

    // scene callbacks
    this.sceneMgr.onRedexClick = (path) => {
      this.stopRun()
      void this.interrupt().then(() => {
        // the path came from the view that was showing when clicked; make
        // sure it is still a redex of the current term
        const stillRedex = redexes(this.current).some((r) => pathKey(r) === pathKey(path))
        if (stillRedex) this.reduceAt(path, true)
      })
    }
    this.sceneMgr.onHoverNode = (key) => {
      this.highlightSpan(key)
    }
    this.sceneMgr.onXRAction = (action) => {
      if (action === 'step') void this.step()
      else if (action === 'back') void this.back()
      else if (action === 'reset') void this.reset()
      else if (action === 'run') void this.runToNormalForm()
      else if (action === 'strategy') {
        this.strategySelect.value = this.strategy === 'normal' ? 'applicative' : 'normal'
        this.sceneMgr.setVRButtonLabel('strategy', `strategy: ${this.strategySelect.value}`)
      } else if (action.startsWith('preset:')) {
        const i = parseInt(action.slice('preset:'.length), 10)
        const preset = PRESETS[i]
        if (preset) {
          void this.interrupt().then(() => {
            $<HTMLTextAreaElement>('term-input').value = preset.src
            if (this.loadSource(preset.src)) this.markActivePreset(i)
          })
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

new App()
