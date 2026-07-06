import { AudioEngine } from './engine'

// Sound cues for the beta choreography. Everything lives on a D-rooted
// major pentatonic so cues, landing chimes and the ambient bed stay
// consonant no matter how they overlap. Landing chimes are pitched by the
// variable's binder hue — the same identity channel the tethers encode
// visually: one binder, one colour, one note.

/** Two octaves of major pentatonic, semitones above the base. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]

const D3 = 146.83
const D4 = 293.66
const A4 = 440.0
const D5 = 587.33
const D6 = 1174.66

export class Sfx {
  constructor(private eng: AudioEngine) {}

  private note(base: number, degree: number): number {
    const d = ((degree % PENTA.length) + PENTA.length) % PENTA.length
    return base * Math.pow(2, PENTA[d] / 12)
  }

  private hueFreq(hue: number | null): number {
    const idx =
      hue === null
        ? Math.floor(Math.random() * PENTA.length)
        : Math.floor((((hue % 360) + 360) % 360) / 360 * PENTA.length)
    return this.note(D5, idx)
  }

  /** Phase 1 — the redex lifts out of the tree: a low slow swell. */
  focus(dur: number): void {
    this.eng.tone({ freq: D3, dur: dur + 0.5, attack: dur * 0.6, gain: 0.13, type: 'triangle', wet: 0.7 })
    this.eng.tone({ freq: D3 * 1.5, dur: dur + 0.4, attack: dur * 0.7, gain: 0.06, wet: 0.7 })
  }

  /** Beat A — @ and λ flash as one unit: a warm rising hum. */
  identify(dur: number): void {
    this.eng.tone({ freq: D4, endFreq: this.note(D4, 1), dur: dur + 0.25, attack: 0.05, gain: 0.12, type: 'triangle', wet: 0.6 })
    this.eng.tone({ freq: A4, dur: dur + 0.15, attack: 0.04, gain: 0.055, wet: 0.7 })
  }

  /** Beat B — the binder and its variables pulse: paired pings, one per
   *  occurrence (capped — three reads as "several"). */
  binding(dur: number, occurrences: number): void {
    const n = Math.min(3, Math.max(1, occurrences))
    for (let i = 0; i < n; i++) {
      this.eng.chime({
        freq: this.note(D5, 2 + i * 2),
        dur: 1.1,
        gain: 0.075,
        pan: (i - (n - 1) / 2) * 0.35,
        wet: 0.8,
        delay: (i * dur) / (n + 1),
      })
    }
  }

  /** Beat C — the argument subtree flashes whole: a quick harp brush. */
  argument(dur: number): void {
    for (let i = 0; i < 3; i++) {
      this.eng.chime({
        freq: this.note(D5, 1 + i * 2),
        dur: 0.9,
        gain: 0.07,
        pan: 0.15 * (i - 1),
        wet: 0.8,
        delay: i * dur * 0.22,
      })
    }
  }

  /** Phase 3 — copies fly the arcs: an airy rising whoosh sized to the
   *  whole flight (staggers included), fuller with more copies. */
  fly(dur: number, copies: number): void {
    this.eng.wash({ from: 280, to: 1500, dur, gain: 0.13 + 0.025 * Math.min(4, copies), wet: 0.5, q: 1.4 })
  }

  /** A copy lands on its variable: a glass chime in the binder's hue. */
  land(hue: number | null, pan: number): void {
    this.eng.chime({ freq: this.hueFreq(hue), dur: 1.6, gain: 0.14, pan, wet: 0.8 })
  }

  /** Unused argument evaporates: a falling breath, no chime — nothing
   *  arrives anywhere. */
  evaporate(dur: number): void {
    this.eng.wash({ from: 1300, to: 200, dur: dur + 0.2, gain: 0.1, wet: 0.7 })
  }

  /** Phase 4 — λ and @ collapse into each other: a soft low absorb. */
  merge(dur: number): void {
    this.eng.tone({ freq: 220, endFreq: 73, dur: dur + 0.3, attack: 0.015, gain: 0.14, wet: 0.5 })
  }

  /** Phase 5 — the tree settles: a resolving pad under the ripple, with a
   *  single high confirmation chime as it completes. */
  settle(dur: number): void {
    this.eng.tone({ freq: D4, dur: dur + 0.7, attack: dur * 0.35, gain: 0.07, type: 'triangle', wet: 0.8 })
    this.eng.tone({ freq: D4 * 1.5, dur: dur + 0.6, attack: dur * 0.45, gain: 0.045, wet: 0.8, delay: dur * 0.15 })
    this.eng.chime({ freq: D6, dur: 1.8, gain: 0.04, wet: 0.9, delay: dur * 0.55 })
  }

  /** Idle glint on a candidate redex: the faintest star ping. */
  sparkle(pan: number): void {
    this.eng.chime({
      freq: this.note(D6, Math.floor(Math.random() * 5) * 2),
      dur: 0.9,
      gain: 0.016,
      pan,
      wet: 0.9,
    })
  }
}
