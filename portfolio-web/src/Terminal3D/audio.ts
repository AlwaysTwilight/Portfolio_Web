// ── Procedural audio engine (Web Audio API, zero asset files) ────────────────
// Generative ambient music + SFX (footsteps, chat blips, PC login chime).

type Win = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }

export class AudioManager {
  private ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private reverb: ConvolverNode
  private noiseBuf: AudioBuffer
  private chordTimer: number | null = null
  private melodyTimer: number | null = null
  private beatTimer: number | null = null
  private musicStarted = false
  private chordIdx = 0
  private beatStep = 0
  muted = false

  // soothing progression in C major (low, lush pads)
  private chords = [
    [87.31, 130.81, 164.81, 196.0],   // Fmaj7-ish
    [110.0, 164.81, 196.0, 246.94],   // Am7
    [146.83, 174.61, 220.0, 261.63],  // Dm7
    [130.81, 164.81, 196.0, 293.66],  // Cadd9
  ]
  private pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0]

  constructor() {
    const w = window as Win
    this.ctx = new (w.AudioContext || w.webkitAudioContext!)()
    this.master = this.ctx.createGain(); this.master.gain.value = 0.85; this.master.connect(this.ctx.destination)

    this.reverb = this.ctx.createConvolver(); this.reverb.buffer = this.impulse(2.8, 2.4)
    const revGain = this.ctx.createGain(); revGain.gain.value = 0.55
    this.reverb.connect(revGain); revGain.connect(this.master)

    this.music = this.ctx.createGain(); this.music.gain.value = 0.0
    this.music.connect(this.reverb); this.music.connect(this.master)

    this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.5; this.sfx.connect(this.master)

    // reusable white-noise buffer for footsteps
    const len = Math.floor(this.ctx.sampleRate * 0.3)
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }

  private impulse(dur: number, decay: number) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * dur)
    const buf = this.ctx.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    return buf
  }

  async resume() { if (this.ctx.state !== 'running') { try { await this.ctx.resume() } catch { /* ignore */ } } }

  // ── music (a lofi beat now, not just an ambient chord wash — this is meant
  //    to be "the record player's song", started/stopped on demand rather
  //    than autoplaying the moment the page loads) ──
  startMusic() {
    if (this.musicStarted) return
    this.musicStarted = true
    const now = this.ctx.currentTime
    this.music.gain.cancelScheduledValues(now)
    this.music.gain.setValueAtTime(this.music.gain.value, now)
    this.music.gain.linearRampToValueAtTime(0.16, now + 1.4)
    this.scheduleChord()
    this.scheduleMelody()
    this.scheduleBeat()
  }

  stopMusic() {
    if (!this.musicStarted) return
    this.musicStarted = false
    const now = this.ctx.currentTime
    this.music.gain.cancelScheduledValues(now)
    this.music.gain.setValueAtTime(this.music.gain.value, now)
    this.music.gain.linearRampToValueAtTime(0.0001, now + 0.8)
    if (this.chordTimer) { clearTimeout(this.chordTimer); this.chordTimer = null }
    if (this.melodyTimer) { clearTimeout(this.melodyTimer); this.melodyTimer = null }
    if (this.beatTimer) { clearTimeout(this.beatTimer); this.beatTimer = null }
  }

  private scheduleBeat() {
    const stepDur = 0.46 // ~130bpm eighth notes, a lofi head-nod tempo
    const pattern = [1, 0, 0.6, 0, 1, 0.6, 0, 0.6] // 1 = kick+hat, 0.6 = hat only
    const v = pattern[this.beatStep % pattern.length]
    if (v >= 1) this.kick()
    if (v > 0) this.hihat(v >= 1 ? 0.05 : 0.035)
    this.beatStep++
    this.beatTimer = window.setTimeout(() => this.scheduleBeat(), stepDur * 1000)
  }

  private kick() {
    const now = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(120, now)
    o.frequency.exponentialRampToValueAtTime(42, now + 0.11)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.22, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    o.connect(g); g.connect(this.music)
    o.start(now); o.stop(now + 0.24)
  }

  private hihat(vol: number) {
    const now = this.ctx.currentTime
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf
    const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 6500
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.045)
    src.connect(filt); filt.connect(g); g.connect(this.music)
    src.start(now); src.stop(now + 0.05)
  }

  private scheduleChord() {
    this.playChord(this.chords[this.chordIdx])
    this.chordIdx = (this.chordIdx + 1) % this.chords.length
    this.chordTimer = window.setTimeout(() => this.scheduleChord(), 7200)
  }

  private playChord(freqs: number[]) {
    const now = this.ctx.currentTime
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1300; filt.Q.value = 0.6
    filt.connect(this.music)
    freqs.forEach(f => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f
      const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = 7
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.0001, now)
      g.gain.linearRampToValueAtTime(0.16, now + 2.6)
      g.gain.linearRampToValueAtTime(0.0001, now + 7.2)
      o.connect(g); o2.connect(g); g.connect(filt)
      o.start(now); o2.start(now); o.stop(now + 7.4); o2.stop(now + 7.4)
    })
  }

  private scheduleMelody() {
    if (Math.random() > 0.35) this.bell(this.pentatonic[Math.floor(Math.random() * this.pentatonic.length)])
    this.melodyTimer = window.setTimeout(() => this.scheduleMelody(), 2400 + Math.random() * 2800)
  }

  private bell(freq: number) {
    const now = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.09, now + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8)
    o.connect(g); g.connect(this.reverb); g.connect(this.master)
    o.start(now); o.stop(now + 1.9)
  }

  // ── SFX ──
  footstep() {
    if (this.muted) return
    const now = this.ctx.currentTime
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = 0.85 + Math.random() * 0.3
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 380 + Math.random() * 120
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(0.16, now + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)
    src.connect(filt); filt.connect(g); g.connect(this.sfx)
    src.start(now); src.stop(now + 0.16)
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
    const now = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, now)
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, now + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(vol, now + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    o.connect(g); g.connect(this.sfx)
    o.start(now); o.stop(now + dur + 0.02)
  }

  blipSend() { if (!this.muted) this.tone(520, 0.14, 'sine', 0.18, 820) }
  blipRecv() { if (this.muted) return; this.tone(760, 0.12, 'sine', 0.16); setTimeout(() => this.tone(560, 0.16, 'sine', 0.14), 90) }
  click()    { if (!this.muted) this.tone(1100, 0.05, 'square', 0.05) }

  pcOpen() {
    if (this.muted) return
    const seq = [523.25, 659.25, 783.99, 1046.5]
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'sine', 0.14), i * 110))
  }

  // Airy "whoosh" when a holographic panel opens.
  panelOpen() { if (!this.muted) { this.tone(320, 0.26, 'sine', 0.12, 720); setTimeout(() => this.tone(900, 0.18, 'triangle', 0.08), 60) } }
  // Soft high tick when a project pillar becomes focusable.
  focusPing() { if (!this.muted) this.tone(1320, 0.08, 'sine', 0.06, 1560) }

  setMuted(m: boolean) {
    this.muted = m
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.85, now + 0.2)
  }

  dispose() {
    if (this.chordTimer) clearTimeout(this.chordTimer)
    if (this.melodyTimer) clearTimeout(this.melodyTimer)
    if (this.beatTimer) clearTimeout(this.beatTimer)
    try { this.ctx.close() } catch { /* ignore */ }
  }
}
