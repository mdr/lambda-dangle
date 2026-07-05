// Minimal tween engine. All animation in the app flows through one Animator
// so a single speed dial / instant mode / fast-forward affects everything.

export type Ease = (t: number) => number

export const easeInOut: Ease = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
export const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)
export const linear: Ease = (t) => t

interface Active {
  dur: number
  elapsed: number
  ease: Ease
  apply: (k: number) => void
  resolve: () => void
}

export class Animator {
  /** Playback speed multiplier (0.25–3 from the UI slider). */
  speed = 1
  /** Instant mode: every tween completes on creation. */
  instant = false
  /** Set while the user has asked to skip the current choreography. */
  skipping = false

  private active: Active[] = []

  get busy(): boolean {
    return this.active.length > 0
  }

  tween(dur: number, apply: (k: number) => void, ease: Ease = easeInOut): Promise<void> {
    if (dur <= 0 || this.instant || this.skipping) {
      apply(1)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.active.push({ dur, elapsed: 0, ease, apply, resolve })
    })
  }

  delay(dur: number): Promise<void> {
    return this.tween(dur, () => {}, linear)
  }

  update(dt: number): void {
    if (this.active.length === 0) return
    const step = dt * this.speed
    const finished: Active[] = []
    this.active = this.active.filter((a) => {
      a.elapsed += step
      const k = Math.min(1, a.elapsed / a.dur)
      a.apply(a.ease(k))
      if (k >= 1) {
        finished.push(a)
        return false
      }
      return true
    })
    for (const a of finished) a.resolve()
  }

  /** Complete every active tween immediately. */
  fastForward(): void {
    const all = this.active
    this.active = []
    for (const a of all) {
      a.apply(1)
      a.resolve()
    }
  }

  /** Skip the in-flight choreography: finish current tweens and make
   *  subsequent ones instant until `endSkip` is called. */
  skip(): void {
    this.skipping = true
    this.fastForward()
  }

  endSkip(): void {
    this.skipping = false
  }
}
