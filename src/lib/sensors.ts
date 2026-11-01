export type Perm = 'granted' | 'denied' | 'unavailable';

const rad = (d: number) => (d * Math.PI) / 180;
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const dead = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.06) / 0.94;

type AnyEvt = { requestPermission?: () => Promise<string> };

export class Sensors {
  /** gravity in screen space, -1..1 */
  tilt = { x: 0, y: 0 };
  /** 0..1 blow strength from the microphone */
  blow = 0;
  hasMotion = false;
  hasMic = false;
  onShake: (strength: number) => void = () => {};

  private beta = 0;
  private gamma = 0;
  private haveOri = false;
  private haveBase = false;
  private baseB = 0;
  private baseG = 0;
  private lastB = 0;
  private lastG = 0;
  private still = 0;
  private lastAcc: [number, number, number] | null = null;
  private lastShake = 0;
  private bound = false;

  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private stream?: MediaStream;
  private td?: Float32Array;
  private fd?: Uint8Array;
  private floor = 0.004;

  /** Must be called synchronously inside the user gesture (iOS). */
  prepareAudio() {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC && !this.ctx) {
        this.ctx = new AC();
        void this.ctx.resume();
      }
    } catch {
      /* ignore */
    }
  }

  /** Call synchronously from the tap handler; awaits the result. */
  async requestMotion(): Promise<Perm> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: AnyEvt }).DeviceOrientationEvent;
    const DME = (window as unknown as { DeviceMotionEvent?: AnyEvt }).DeviceMotionEvent;
    if (!DOE && !DME) return 'unavailable';
    const reqs: Promise<string>[] = [];
    try {
      if (typeof DOE?.requestPermission === 'function') reqs.push(DOE.requestPermission());
      if (typeof DME?.requestPermission === 'function') reqs.push(DME.requestPermission());
    } catch {
      return 'denied';
    }
    if (reqs.length) {
      const res = await Promise.allSettled(reqs);
      const ok = res.some((r) => r.status === 'fulfilled' && r.value === 'granted');
      if (!ok) return 'denied';
    }
    this.bind();
    // wait briefly for a real reading (desktops fire one event with null values)
    for (let i = 0; i < 8 && !this.haveOri; i++) await new Promise((r) => setTimeout(r, 100));
    this.hasMotion = this.haveOri;
    return this.haveOri ? 'granted' : 'unavailable';
  }

  private bind() {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      this.beta = e.beta;
      this.gamma = e.gamma;
      this.haveOri = true;
    });
    window.addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const cur: [number, number, number] = [a.x, a.y, a.z];
      const p = this.lastAcc;
      this.lastAcc = cur;
      if (!p) return;
      const j = Math.hypot(cur[0] - p[0], cur[1] - p[1], cur[2] - p[2]);
      const now = performance.now();
      if (j > 22 && now - this.lastShake > 1100) {
        this.lastShake = now;
        this.onShake(Math.min(1.5, Math.max(0.7, j / 30)));
      }
    });
  }

  async requestMic(): Promise<Perm> {
    if (!navigator.mediaDevices?.getUserMedia || !this.ctx) return 'unavailable';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const src = this.ctx.createMediaStreamSource(this.stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.25;
      src.connect(an); // never connected to the speakers: nothing is played, recorded or sent
      this.analyser = an;
      this.td = new Float32Array(an.fftSize);
      this.fd = new Uint8Array(an.frequencyBinCount);
      this.hasMic = true;
      return 'granted';
    } catch (e) {
      const name = (e as DOMException)?.name;
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
    }
  }

  private angle(): number {
    const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    return ((a % 360) + 360) % 360;
  }

  /** Per-frame update of tilt and blow readings. */
  poll(dt: number) {
    if (this.haveOri) this.pollTilt(dt);
    if (this.analyser) this.pollMic();
  }

  private pollTilt(dt: number) {
    const { beta, gamma } = this;
    if (!this.haveBase) {
      this.baseB = beta;
      this.baseG = gamma;
      this.haveBase = true;
      this.lastB = beta;
      this.lastG = gamma;
    }
    const mv = (Math.abs(wrap(beta - this.lastB)) + Math.abs(gamma - this.lastG)) / Math.max(dt, 0.001);
    this.lastB = beta;
    this.lastG = gamma;
    this.still = mv < 14 ? this.still + dt : 0;
    if (this.still > 4) {
      // a steady new grip becomes the new "rest" position
      const k = Math.min(1, dt * 0.9);
      this.baseB += wrap(beta - this.baseB) * k;
      this.baseG += (gamma - this.baseG) * k;
    }
    const flat = 1 - smooth(10, 22, Math.max(Math.abs(beta), Math.abs(gamma)));
    const keep = 1 - flat; // lying flat always means "home"
    const dx = dead(Math.sin(rad(gamma - this.baseG)) * 1.3) * keep;
    const dy = dead(Math.sin(rad(wrap(beta - this.baseB))) * 1.3) * keep;
    let sx = dx;
    let sy = dy;
    switch (this.angle()) {
      case 90:
        sx = -dy;
        sy = dx;
        break;
      case 180:
        sx = -dx;
        sy = -dy;
        break;
      case 270:
        sx = dy;
        sy = -dx;
        break;
    }
    const m = Math.hypot(sx, sy);
    const c = m > 1 ? 1 / m : 1;
    this.tilt.x = sx * c;
    this.tilt.y = sy * c;
  }

  private pollMic() {
    const an = this.analyser!;
    const td = this.td!;
    const fd = this.fd!;
    an.getFloatTimeDomainData(td as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
    const rms = Math.sqrt(sum / td.length);
    // adaptive noise floor: follows quiet rooms quickly, loud moments slowly
    this.floor += (rms - this.floor) * (rms < this.floor * 1.5 + 0.004 ? 0.03 : 0.0015);
    an.getByteFrequencyData(fd as Uint8Array<ArrayBuffer>);
    let low = 0;
    let mid = 0;
    for (let i = 1; i <= 8; i++) low += fd[i];
    for (let i = 10; i <= 120; i++) mid += fd[i];
    const ratio = low / 8 / (mid / 111 + 1);
    // breath is broadband but low-heavy; speech is not. Soft weight, never zero.
    const w = Math.min(1, Math.max(0.4, (ratio - 0.8) / 0.6));
    const lvl = Math.min(1, Math.max(0, (rms - this.floor * 1.5 - 0.012) / 0.13));
    this.blow = lvl * w;
  }

  suspend() {
    void this.ctx?.suspend().catch(() => {});
    this.blow = 0;
  }

  /** Re-arm audio after the page returns to the foreground. */
  async resume() {
    try {
      await this.ctx?.resume();
    } catch {
      /* needs a gesture; retried on next touch */
    }
    const track = this.stream?.getAudioTracks()[0];
    if (this.hasMic && track && track.readyState === 'ended') {
      this.hasMic = false;
      this.analyser = undefined;
      this.blow = 0;
    }
  }
}
