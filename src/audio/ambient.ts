import { AudioEngine } from './engine'

// Generative ambient bed, Eno-style: a slowly breathing pad drifting
// between open chords on the same D pentatonic as the sound effects,
// sparse high star-notes, and a whisper of filtered air. It is not a loop
// — it is composed continuously by chance, so it never repeats.

const ROOT = 73.42 // D2

/** Chord tones as semitones above ROOT — open voicings, all pentatonic
 *  (plus one plagal G) so the drift never lands anywhere tense. */
const CHORDS: number[][] = [
  [0, 12, 19, 28], // D · D · A · F#   open, bright
  [0, 9, 16, 24],  // D · B · F# · D   warmer
  [0, 7, 14, 26],  // D · A · E · E    suspended
  [-5, 7, 12, 21], // G · A · D · B    plagal drift
]

const VOICE_GAINS = [0.075, 0.05, 0.042, 0.03]
const PENTA = [0, 2, 4, 7, 9]

interface Voice {
  oscs: OscillatorNode[]
  gain: GainNode
  lfo: OscillatorNode
}

export class Ambient {
  private playing = false
  private voices: Voice[] = []
  private extraStops: (() => void)[] = []
  private timers: ReturnType<typeof setTimeout>[] = []
  private chordIdx = 0

  constructor(private eng: AudioEngine) {}

  start(): void {
    if (this.playing) return
    const ctx = this.eng.context
    if (!ctx) return
    this.playing = true
    const t = ctx.currentTime

    // shared mellowing filter for the whole pad
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 750
    this.eng.route(lowpass, 0, 0.75)

    CHORDS[0].forEach((semi, i) => {
      const freq = ROOT * Math.pow(2, semi / 12)
      const gain = ctx.createGain()
      const base = VOICE_GAINS[i]
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(base, t + 5) // pad fades in slowly
      gain.connect(lowpass)

      // each voice breathes at its own slow rate
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.025 + i * 0.013
      const lfoDepth = ctx.createGain()
      lfoDepth.gain.value = base * 0.45
      lfo.connect(lfoDepth)
      lfoDepth.connect(gain.gain)
      lfo.start(t)

      const oscs = [-4, 4].map((cents) => {
        const osc = ctx.createOscillator()
        osc.type = 'triangle'
        osc.frequency.value = freq
        osc.detune.value = cents
        osc.connect(gain)
        osc.start(t)
        return osc
      })
      this.voices.push({ oscs, gain, lfo })
    })

    // a whisper of air, barely there
    if (this.eng.noise) {
      const src = ctx.createBufferSource()
      src.buffer = this.eng.noise
      src.loop = true
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1600
      bp.Q.value = 0.7
      const g = ctx.createGain()
      g.gain.value = 0.008
      src.connect(bp)
      bp.connect(g)
      this.eng.route(g, 0, 0.6)
      src.start(t)
      this.extraStops.push(() => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.2)
        src.stop(ctx.currentTime + 1)
      })
    }

    this.scheduleChordDrift()
    this.scheduleStar()
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    const ctx = this.eng.context!
    const t = ctx.currentTime
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(t)
      v.gain.gain.setTargetAtTime(0, t, 0.2)
      for (const osc of v.oscs) osc.stop(t + 1)
      v.lfo.stop(t + 1)
    }
    this.voices = []
    for (const s of this.extraStops) s()
    this.extraStops = []
  }

  /** Every 25–45 s, glide the pad to another chord over ~8 s. */
  private scheduleChordDrift(): void {
    const timer = setTimeout(() => {
      if (!this.playing) return
      const ctx = this.eng.context!
      this.chordIdx = (this.chordIdx + 1 + Math.floor(Math.random() * (CHORDS.length - 1))) % CHORDS.length
      CHORDS[this.chordIdx].forEach((semi, i) => {
        const v = this.voices[i]
        if (!v) return
        const freq = ROOT * Math.pow(2, semi / 12)
        for (const osc of v.oscs) osc.frequency.setTargetAtTime(freq, ctx.currentTime, 4)
      })
      this.scheduleChordDrift()
    }, 25000 + Math.random() * 20000)
    this.timers.push(timer)
  }

  /** Sparse high star-notes, one every 6–15 s, wherever chance puts them. */
  private scheduleStar(): void {
    const timer = setTimeout(() => {
      if (!this.playing) return
      const octave = Math.random() < 0.3 ? 8 : 4
      const semi = PENTA[Math.floor(Math.random() * PENTA.length)]
      this.eng.chime({
        freq: ROOT * octave * Math.pow(2, semi / 12),
        dur: 3 + Math.random() * 2,
        gain: 0.025 + Math.random() * 0.02,
        pan: (Math.random() - 0.5) * 1.2,
        wet: 0.9,
      })
      this.scheduleStar()
    }, 6000 + Math.random() * 9000)
    this.timers.push(timer)
  }
}
