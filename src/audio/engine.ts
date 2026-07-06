// Procedural audio: one AudioContext, a master gain, and a shared
// generated-impulse-response reverb. Everything the app plays is
// synthesized right here — no audio assets, nothing to license, and every
// sound can be parameterized by what is happening on screen.

const MASTER_LEVEL = 0.5

export interface ToneOpts {
  freq: number
  /** Glide the pitch here over `glide` seconds (defaults to `dur`). */
  endFreq?: number
  glide?: number
  type?: OscillatorType
  /** Total length, seconds (attack + decay). */
  dur: number
  attack?: number
  gain: number
  pan?: number
  /** Reverb send, 0..1. */
  wet?: number
  detune?: number
  /** Start this many seconds in the future. */
  delay?: number
  /** Mix group: 'ambient' voices duck under the choreography. */
  bus?: 'sfx' | 'ambient'
}

export interface ChimeOpts {
  freq: number
  dur: number
  gain: number
  pan?: number
  wet?: number
  delay?: number
  bus?: 'sfx' | 'ambient'
}

export interface WashOpts {
  from: number
  to: number
  dur: number
  gain: number
  pan?: number
  wet?: number
  q?: number
  delay?: number
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private dryBus: GainNode | null = null
  private wetBus: GainNode | null = null
  /** Ambient group: dry path and reverb send, both duckable. */
  private ambDry: GainNode | null = null
  private ambSend: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  enabled = false

  get context(): AudioContext | null {
    return this.ctx
  }

  /** For tests / metering. */
  get masterOut(): GainNode | null {
    return this.master
  }

  get noise(): AudioBuffer | null {
    return this.noiseBuf
  }

  /** Ideally called from a user gesture; outside one, the context stays
   *  suspended (autoplay policy) and wakes on the next enable() call. */
  enable(): void {
    if (!this.ctx) this.init()
    const ctx = this.ctx!
    ctx.resume().catch(() => {})
    this.enabled = true
    this.master!.gain.cancelScheduledValues(ctx.currentTime)
    this.master!.gain.setTargetAtTime(MASTER_LEVEL, ctx.currentTime, 0.15)
  }

  disable(): void {
    if (!this.ctx || !this.master) return
    this.enabled = false
    this.master.gain.cancelScheduledValues(this.ctx.currentTime)
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
  }

  private init(): void {
    const ctx = new AudioContext()
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(ctx.destination)

    this.dryBus = ctx.createGain()
    this.dryBus.connect(this.master)

    const convolver = ctx.createConvolver()
    convolver.buffer = impulseResponse(ctx, 3.4, 2.4)
    this.wetBus = ctx.createGain()
    this.wetBus.connect(convolver)
    convolver.connect(this.master)

    this.ambDry = ctx.createGain()
    this.ambDry.connect(this.master)
    this.ambSend = ctx.createGain()
    this.ambSend.connect(this.wetBus)

    this.noiseBuf = noiseBuffer(ctx, 2)
  }

  /** Sidechain-style duck: the ambient bed dips fast under the
   *  choreography and swells back slowly afterwards. Reverb tails already
   *  in the hall keep ringing, which is what a real room would do. */
  duck(on: boolean): void {
    if (!this.ctx || !this.ambDry || !this.ambSend) return
    const t = this.ctx.currentTime
    const g = on ? 0.2 : 1
    const tau = on ? 0.2 : 1.5
    this.ambDry.gain.setTargetAtTime(g, t, tau)
    this.ambSend.gain.setTargetAtTime(g, t, tau)
  }

  /** Wire a voice's output into the mix: pan, then dry + reverb send.
   *  Ambient-bus voices go through the duckable group instead. */
  route(node: AudioNode, pan = 0, wet = 0.5, bus: 'sfx' | 'ambient' = 'sfx'): void {
    const ctx = this.ctx!
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    node.connect(p)
    const dry = ctx.createGain()
    dry.gain.value = 1 - wet * 0.5
    p.connect(dry)
    dry.connect(bus === 'ambient' ? this.ambDry! : this.dryBus!)
    const send = ctx.createGain()
    send.gain.value = wet
    p.connect(send)
    send.connect(bus === 'ambient' ? this.ambSend! : this.wetBus!)
  }

  /** One enveloped oscillator: linear attack, exponential decay. */
  tone(o: ToneOpts): void {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime + (o.delay ?? 0)
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.freq, t)
    if (o.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFreq), t + (o.glide ?? o.dur))
    }
    if (o.detune) osc.detune.value = o.detune
    const attack = Math.min(o.attack ?? 0.02, o.dur * 0.9)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(o.gain, t + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
    osc.connect(env)
    this.route(env, o.pan, o.wet, o.bus)
    osc.start(t)
    osc.stop(t + o.dur + 0.1)
  }

  /** A struck-glass bell: a few inharmonic partials, fast attack, long
   *  ring. The 2.76/5.40 ratios are what make it glass and not organ. */
  chime(o: ChimeOpts): void {
    const partials: [number, number][] = [
      [1, 1],
      [2.76, 0.3],
      [5.4, 0.09],
    ]
    for (const [ratio, level] of partials) {
      this.tone({
        freq: o.freq * ratio,
        dur: o.dur * (ratio === 1 ? 1 : 0.55),
        attack: 0.006,
        gain: o.gain * level,
        pan: o.pan,
        wet: o.wet ?? 0.75,
        delay: o.delay,
        bus: o.bus,
      })
    }
  }

  /** Band-filtered noise with a swept center frequency — airy whooshes
   *  (rising) and evaporations (falling). */
  wash(o: WashOpts): void {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return
    const ctx = this.ctx
    const t = ctx.currentTime + (o.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = o.q ?? 1.2
    bp.frequency.setValueAtTime(o.from, t)
    bp.frequency.exponentialRampToValueAtTime(o.to, t + o.dur)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(o.gain, t + o.dur * 0.35)
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
    src.connect(bp)
    bp.connect(env)
    this.route(env, o.pan, o.wet ?? 0.45)
    src.start(t)
    src.stop(t + o.dur + 0.1)
  }
}

/** Reverb IR: exponentially decaying stereo noise — a big soft dark hall. */
function impulseResponse(ctx: AudioContext, dur: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * dur)
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

function noiseBuffer(ctx: AudioContext, dur: number): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * dur)
  const buf = ctx.createBuffer(1, len, rate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}
