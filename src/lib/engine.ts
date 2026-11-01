import { THEMES, type RGB, type ThemeName } from './themes';
import { sampleText } from './text';

const VERT = `
attribute vec3 a_p;
attribute vec2 a_s;
uniform vec2 u_res;
uniform float u_size;
uniform float u_time;
uniform float u_k;
uniform vec3 uA0, uA1, uA2, uB0, uB1, uB2;
uniform float u_mix;
varying vec3 v_col;
varying float v_a;
void main() {
  vec2 c = a_p.xy / u_res;
  gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
  float sp = clamp(a_p.z / 14.0, 0.0, 1.0);
  float tw = 0.84 + 0.16 * sin(u_time * (1.2 + a_s.y * 2.2) + a_s.y * 40.0);
  gl_PointSize = u_size * (0.68 + 0.64 * a_s.y) * (1.0 + sp * 0.45);
  float t = a_s.x;
  vec3 ca = t < 0.5 ? mix(uA0, uA1, t * 2.0) : mix(uA1, uA2, (t - 0.5) * 2.0);
  vec3 cb = t < 0.5 ? mix(uB0, uB1, t * 2.0) : mix(uB1, uB2, (t - 0.5) * 2.0);
  vec3 col = mix(ca, cb, u_mix);
  v_col = mix(col, vec3(1.0), sp * 0.4);
  v_a = u_k * tw * (0.75 + 0.5 * a_s.y) * (1.0 + sp * 0.7);
}`;

const FRAG = `
precision mediump float;
varying vec3 v_col;
varying float v_a;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float g = exp(-d * 4.5) + exp(-d * 18.0) * 0.6;
  gl_FragColor = vec4(v_col * g * v_a, 1.0);
}`;

interface Ptr {
  x: number;
  y: number;
  speed: number;
  boost: number;
}

const MIN_PARTICLES = 5000;

export class ParticleEngine {
  readonly canvas: HTMLCanvasElement;
  private gl!: WebGLRenderingContext;
  private prog!: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private bufPos!: WebGLBuffer;
  private bufSeed!: WebGLBuffer;

  W = 0;
  H = 0;
  dpr = 1;
  readonly max: number;
  n: number;

  private px: Float32Array;
  private py: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private hx: Float32Array;
  private hy: Float32Array;
  private ph: Float32Array;
  private rd: Float32Array;
  private pos: Float32Array;
  private seed: Float32Array;

  text = 'Blow';
  private cx = 0;
  private cy = 0;
  private size = 4;
  private k = 0.7;
  private spacing = 4;

  pointers = new Map<number, Ptr>();
  /** target gravity in screen space, each axis -1..1 */
  tilt = { x: 0, y: 0 };
  /** target wind 0..1 */
  windTarget = 0;
  /** called each frame before physics */
  onTick: (dt: number) => void = () => {};

  private gx = 0;
  private gy = 0;
  private wind = 0;
  private spring = 0.2;
  private time = 0;

  private palA: RGB[];
  private palB: RGB[];
  private bgA: RGB;
  private bgB: RGB;
  private mix = 1;
  private mixEase = 1;
  private raf = 0;
  private last = 0;
  private running = false;
  private lost = false;

  // adaptive quality
  private emaDt = 16.7;
  private emaWork = 2;
  private frames = 0;
  private cooldown = 0;
  /** exposed for debugging */
  fps = 60;

  constructor(canvas: HTMLCanvasElement, theme: ThemeName) {
    this.canvas = canvas;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const mobile = matchMedia('(pointer: coarse)').matches;
    const low = cores <= 4 || mem <= 2;
    this.max = low ? 8000 : mobile ? 12000 : 15000;
    this.n = this.max;

    const m = this.max;
    this.px = new Float32Array(m);
    this.py = new Float32Array(m);
    this.vx = new Float32Array(m);
    this.vy = new Float32Array(m);
    this.hx = new Float32Array(m);
    this.hy = new Float32Array(m);
    this.ph = new Float32Array(m);
    this.rd = new Float32Array(m);
    this.pos = new Float32Array(m * 3);
    this.seed = new Float32Array(m * 2);
    for (let i = 0; i < m; i++) {
      this.ph[i] = Math.random() * Math.PI * 2;
      this.rd[i] = Math.random();
    }

    const th = THEMES[theme];
    this.palA = th.stops.map((s) => [...s] as RGB);
    this.palB = th.stops.map((s) => [...s] as RGB);
    this.bgA = [...th.bg] as RGB;
    this.bgB = [...th.bg] as RGB;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      cancelAnimationFrame(this.raf);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.initGL();
      this.uploadSeeds();
      if (this.running) this.loop();
    });
    this.initGL();
  }

  // ------------------------------------------------------------------ GL
  private initGL() {
    const gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(p, 0, 'a_p');
    gl.bindAttribLocation(p, 1, 'a_s');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(p);
    this.prog = p;
    for (const name of ['u_res', 'u_size', 'u_time', 'u_k', 'u_mix', 'uA0', 'uA1', 'uA2', 'uB0', 'uB1', 'uB2']) {
      this.u[name] = gl.getUniformLocation(p, name);
    }
    this.bufPos = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.bufSeed = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeed);
    gl.bufferData(gl.ARRAY_BUFFER, this.seed, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (this.W) gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private uploadSeeds() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeed);
    gl.bufferData(gl.ARRAY_BUFFER, this.seed, gl.DYNAMIC_DRAW);
  }

  // ------------------------------------------------------------ layout
  resize(): boolean {
    const W = Math.max(1, Math.round(window.innerWidth));
    const H = Math.max(1, Math.round(window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (W === this.W && H === this.H && dpr === this.dpr) return false;
    const first = this.W === 0;
    const sx = first ? 1 : W / this.W;
    const sy = first ? 1 : H / this.H;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    if (!this.lost) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (first) {
      for (let i = 0; i < this.max; i++) {
        this.px[i] = Math.random() * W;
        this.py[i] = Math.random() * H;
      }
    } else {
      for (let i = 0; i < this.max; i++) {
        this.px[i] *= sx;
        this.py[i] *= sy;
      }
    }
    this.rebuild();
    return true;
  }

  setText(text: string) {
    this.text = text;
    if (this.W) this.rebuild();
  }

  private rebuild() {
    const m = this.max;
    const s = sampleText(this.text, this.W, this.H, m);
    this.hx.set(s.x);
    this.hy.set(s.y);
    let sy = 0;
    const span = Math.max(1, s.maxX - s.minX);
    for (let i = 0; i < m; i++) {
      sy += s.y[i];
      this.seed[i * 2] = 0.55 * this.rd[i] + 0.45 * ((s.x[i] - s.minX) / span);
      this.seed[i * 2 + 1] = this.rd[(i * 7 + 3) % m];
    }
    this.cx = (s.minX + s.maxX) / 2;
    this.cy = sy / m;
    this.area = s.area;
    this.uploadSeeds();
    this.look();
  }

  private area = 1;

  private look() {
    this.spacing = Math.sqrt(this.area / this.n);
    const raw = this.spacing * 2.6;
    const size = Math.min(13, Math.max(2.6, raw));
    this.size = size * this.dpr;
    // keep total brightness constant when the point size had to be clamped
    this.k = Math.min(1.1, Math.max(0.16, 0.72 * (raw / size) ** 2));
  }

  // ----------------------------------------------------------- appearance
  setTheme(name: ThemeName, instant = false) {
    const th = THEMES[name];
    if (instant) {
      this.palA = th.stops.map((s) => [...s] as RGB);
      this.palB = th.stops.map((s) => [...s] as RGB);
      this.bgA = [...th.bg] as RGB;
      this.bgB = [...th.bg] as RGB;
      this.mix = 1;
      this.mixEase = 1;
      return;
    }
    const e = this.mixEase;
    const lerp = (a: RGB, b: RGB): RGB => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
    this.palA = this.palA.map((c, i) => lerp(c, this.palB[i]));
    this.bgA = lerp(this.bgA, this.bgB);
    this.palB = th.stops.map((s) => [...s] as RGB);
    this.bgB = [...th.bg] as RGB;
    this.mix = 0;
    this.mixEase = 0;
  }

  // ------------------------------------------------------------- events
  /** Radial outward burst from the middle of the word. */
  explode(strength = 1) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      const dx = this.px[i] - this.cx + (Math.random() - 0.5) * 40;
      const dy = this.py[i] - this.cy + (Math.random() - 0.5) * 40;
      const inv = 1 / (Math.hypot(dx, dy) + 1);
      const mag = (9 + Math.random() * 26) * strength;
      this.vx[i] += dx * inv * mag + (Math.random() - 0.5) * 6;
      this.vy[i] += dy * inv * mag + (Math.random() - 0.5) * 6;
    }
    this.spring = Math.min(this.spring, 0.04);
  }

  /** Gentle disturbance when the word changes. */
  nudge() {
    for (let i = 0; i < this.max; i++) {
      this.vx[i] += (Math.random() - 0.5) * 6;
      this.vy[i] += (Math.random() - 0.5) * 6;
    }
    this.spring = Math.min(this.spring, 0.55);
  }

  // -------------------------------------------------------------- loop
  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.tick);
  };

  private tick = (t: number) => {
    if (!this.running || this.lost) return;
    this.raf = requestAnimationFrame(this.tick);
    const raw = this.last ? t - this.last : 16.7;
    this.last = t;
    if (raw > 250) return; // came back from background: skip the gap
    const dt = Math.min(0.034, raw / 1000);
    const w0 = performance.now();
    this.onTick(dt);
    this.update(dt);
    this.draw();
    this.adapt(raw, performance.now() - w0);
  };

  private adapt(dtMs: number, workMs: number) {
    this.emaDt += (dtMs - this.emaDt) * 0.05;
    this.emaWork += (workMs - this.emaWork) * 0.05;
    this.fps = 1000 / this.emaDt;
    this.frames++;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    if (this.frames < 90 || this.n <= MIN_PARTICLES) return;
    const capped30 = this.emaDt > 29 && this.emaDt < 37; // Low Power Mode, not our fault
    const slow = this.emaWork > 9 || (this.emaDt > 21 && !capped30);
    if (slow) {
      this.n = Math.max(MIN_PARTICLES, Math.floor(this.n * 0.8));
      this.look();
      this.cooldown = 120;
      this.emaDt = 16.7;
      this.emaWork = 2;
    }
  }

  private update(dt: number) {
    const s = dt * 60;
    this.time += dt;
    const t = this.time;
    const { W, H } = this;
    const n = this.max; // simulate all, draw n (keeps subsets coherent)

    // theme transition
    if (this.mix < 1) {
      this.mix = Math.min(1, this.mix + dt / 0.9);
      const m = this.mix;
      this.mixEase = m * m * (3 - 2 * m);
    }

    // smoothed inputs
    const ks = Math.min(1, dt * 8);
    this.gx += (this.tilt.x - this.gx) * ks;
    this.gy += (this.tilt.y - this.gy) * ks;
    const tAmt = Math.min(1, Math.hypot(this.gx, this.gy) * 1.4);
    const wt = this.windTarget;
    this.wind += (wt - this.wind) * Math.min(1, dt * (wt > this.wind ? 16 : 3.5));
    const wind = this.wind < 0.02 ? 0 : this.wind;

    // spring recovery (slow start so scattered dust drifts before rebuilding)
    this.spring += (1 - this.spring) * (1 - Math.exp(-dt * 0.85));
    if (wind > 0.06) this.spring = Math.min(this.spring, 1 - 0.94 * Math.min(1, wind));
    const sp = this.spring;
    const K = 0.019 * sp * sp * (1 - 0.92 * tAmt);
    const damp = Math.pow(0.885, s);

    // pointers -> flat arrays
    const R = Math.min(130, Math.max(64, Math.min(W, H) * 0.22));
    const R2 = R * R;
    const np = this.pointers.size;
    const qx: number[] = [];
    const qy: number[] = [];
    const qf: number[] = [];
    this.pointers.forEach((p) => {
      qx.push(p.x);
      qy.push(p.y);
      qf.push((1 + Math.min(p.speed, 40) / 22) * p.boost);
      p.speed *= 0.85;
    });

    const gxs = this.gx * 0.55 * s;
    const gys = this.gy * 0.55 * s;
    const walls = tAmt > 0.12 && wind === 0;
    const mx = this.spacing + 4;
    const breath = 1 + 0.012 * Math.sin(t * 1.1);
    const drift = Math.min(2.4, 0.5 * this.spacing + 0.4);
    const { px, py, vx, vy, hx, hy, ph, rd, pos } = this;
    const cx = this.cx;
    const cy = this.cy;
    const windX = W * 0.5;
    const windY = H * 1.08;
    const windA = wind * 2.6 * s;
    const f = 2.1 * s;

    for (let i = 0; i < n; i++) {
      let x = px[i];
      let y = py[i];
      let ux = vx[i];
      let uy = vy[i];
      const p = ph[i];

      // spring toward the (breathing, drifting) home
      const tx = cx + (hx[i] - cx) * breath + Math.sin(t * 0.8 + p) * drift;
      const ty = cy + (hy[i] - cy) * breath + Math.cos(t * 0.65 + p * 1.7) * drift;
      let ax = (tx - x) * K * s + gxs;
      let ay = (ty - y) * K * s + gys;

      // touch force fields
      for (let q = 0; q < np; q++) {
        const dx = x - qx[q];
        const dy = y - qy[q];
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) + 0.5;
          const fall = 1 - d / R;
          const a = (fall * fall * f * qf[q]) / d;
          ax += dx * a - dy * a * 0.22;
          ay += dy * a + dx * a * 0.22;
        }
      }

      // blow: dust carried away from the microphone (bottom edge)
      if (wind > 0) {
        const dx = x - windX;
        const dy = y - windY;
        const inv = 1 / (Math.sqrt(dx * dx + dy * dy) + 1);
        const turb = Math.sin(t * 4 + p * 5);
        const a = windA * (0.5 + rd[i] * 1.0);
        ax += (dx * inv + turb * 0.5) * a;
        ay += (dy * inv - 0.25) * a;
      }

      ux = (ux + ax) * damp;
      uy = (uy + ay) * damp;
      x += ux * s;
      y += uy * s;

      if (walls) {
        const m = mx + rd[i] * 6;
        if (x < m) { x = m; ux *= -0.25; }
        else if (x > W - m) { x = W - m; ux *= -0.25; }
        if (y < m) { y = m; uy *= -0.25; }
        else if (y > H - m) { y = H - m; uy *= -0.25; ux *= 0.9; }
      }

      px[i] = x;
      py[i] = y;
      vx[i] = ux;
      vy[i] = uy;
      const j = i * 3;
      pos[j] = x;
      pos[j + 1] = y;
      pos[j + 2] = Math.sqrt(ux * ux + uy * uy);
    }
  }

  private draw() {
    const gl = this.gl;
    const e = this.mixEase;
    const bg = this.bgA;
    const bb = this.bgB;
    gl.clearColor(bg[0] + (bb[0] - bg[0]) * e, bg[1] + (bb[1] - bg[1]) * e, bg[2] + (bb[2] - bg[2]) * e, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos.subarray(0, this.n * 3));
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeed);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    const u = this.u;
    gl.uniform2f(u.u_res, this.W, this.H);
    gl.uniform1f(u.u_size, this.size);
    gl.uniform1f(u.u_time, this.time);
    gl.uniform1f(u.u_k, this.k);
    gl.uniform1f(u.u_mix, e);
    gl.uniform3fv(u.uA0, this.palA[0]);
    gl.uniform3fv(u.uA1, this.palA[1]);
    gl.uniform3fv(u.uA2, this.palA[2]);
    gl.uniform3fv(u.uB0, this.palB[0]);
    gl.uniform3fv(u.uB1, this.palB[1]);
    gl.uniform3fv(u.uB2, this.palB[2]);
    gl.drawArrays(gl.POINTS, 0, this.n);
  }

  /** Renders a frame and copies it into a 2D canvas (must run in the same task). */
  snapshot(): HTMLCanvasElement {
    this.draw();
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const c = out.getContext('2d')!;
    c.drawImage(this.canvas, 0, 0);
    return out;
  }
}
