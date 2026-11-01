import { ParticleEngine } from '../lib/engine';
import { Sensors } from '../lib/sensors';
import { THEMES, THEME_ORDER, isTheme, type ThemeName } from '../lib/themes';
import { LANGS, detectLang, isLang, setLang, getLang, tr, type Lang } from '../lib/i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DEFAULT_WORD = 'Blow';
const MAX_CHARS = 20;

// ---------------------------------------------------------------- state
const params = new URLSearchParams(location.search);
const clean = (s: string) => Array.from(s.replace(/\s+/g, ' ').trim()).slice(0, MAX_CHARS).join('');
const sharedWord = params.get('w') ? clean(params.get('w')!) : '';
let word = sharedWord || DEFAULT_WORD;
let theme: ThemeName = isTheme(params.get('t')) ? (params.get('t') as ThemeName) : 'warm';
let started = false;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

const qLang = params.get('l');
const initialLang: Lang = isLang(qLang) ? qLang : isLang(store.get('blow-lang')) ? (store.get('blow-lang') as Lang) : detectLang();

// --------------------------------------------------------------- engine
const canvas = $<HTMLCanvasElement>('gl');
let engine: ParticleEngine;
try {
  engine = new ParticleEngine(canvas, theme);
} catch {
  document.body.innerHTML = '<p style="padding:40px;text-align:center">WebGL is not available on this device.</p>';
  throw new Error('WebGL unavailable');
}
const sensors = new Sensors();

function applyThemeUi(instant: boolean) {
  const th = THEMES[theme];
  const root = document.documentElement.style;
  root.setProperty('--accent', th.accent);
  root.setProperty('--s1', th.swatch[0]);
  root.setProperty('--s2', th.swatch[1]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#' + th.bg.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join(''));
  engine.setTheme(theme, instant);
}

function syncUrl() {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('w', word);
  u.searchParams.set('t', theme);
  history.replaceState(null, '', u);
}

function shareUrl() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('w', word);
  u.searchParams.set('t', theme);
  return u.toString();
}

// ------------------------------------------------------------- language
function langLabel(l: Lang) {
  return l === 'ar' ? 'عر' : l.toUpperCase();
}
function applyLang(l: Lang, persist = true) {
  setLang(l);
  $('lang').textContent = langLabel(l);
  $('startLine').textContent = sharedWord ? tr('shared') : tr('tagline');
  if (persist) store.set('blow-lang', l);
}
$('lang').addEventListener('click', () => {
  applyLang(LANGS[(LANGS.indexOf(getLang()) + 1) % LANGS.length]);
});

// ---------------------------------------------------------------- toast
let toastTimer = 0;
function toast(msg: string, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

// ---------------------------------------------------------------- input
let keyBlow = 0;
let burstBlow = 0;
let shakeTimer = 0;

engine.onTick = (dt) => {
  sensors.poll(dt);
  engine.tilt.x = sensors.tilt.x;
  engine.tilt.y = sensors.tilt.y;
  burstBlow = Math.max(0, burstBlow - dt / 0.9);
  engine.windTarget = Math.max(sensors.blow, keyBlow, burstBlow * 0.9);
};

sensors.onShake = (s) => {
  if (!started) return;
  engine.explode(s);
};

// pointers (touch, pen, mouse)
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture?.(e.pointerId);
  engine.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, speed: 0, boost: e.pointerType === 'mouse' ? 1.5 : 1 });
  void sensors.resume();
});
canvas.addEventListener('pointermove', (e) => {
  const p = engine.pointers.get(e.pointerId);
  if (p) {
    p.speed = Math.max(p.speed, Math.hypot(e.clientX - p.x, e.clientY - p.y));
    p.x = e.clientX;
    p.y = e.clientY;
  } else if (e.pointerType === 'mouse') {
    engine.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, speed: 0, boost: 1 }); // hover acts like a finger
  }
});
const lift = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' && e.type === 'pointerup') {
    const p = engine.pointers.get(e.pointerId);
    if (p) p.boost = 1;
    return;
  }
  engine.pointers.delete(e.pointerId);
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('pointerleave', (e) => engine.pointers.delete(e.pointerId));

// no zoom, no bounce
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault());
}
document.addEventListener(
  'touchmove',
  (e) => {
    if ((e.target as HTMLElement).closest('.shot img, input')) return;
    e.preventDefault();
  },
  { passive: false },
);
let lastTap = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTap < 320 && (e.target as HTMLElement).closest('canvas, .dock, .start, .hint')) e.preventDefault();
    lastTap = now;
  },
  { passive: false },
);
document.addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement).closest('.shot img')) e.preventDefault();
});

// keyboard (desktop): B = blow, Space = shake
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === 'b' || e.key === 'B') keyBlow = 0.9;
  else if (e.key === ' ' && started) {
    e.preventDefault();
    engine.explode(1);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'b' || e.key === 'B') keyBlow = 0;
});

// ------------------------------------------------------------ controls
function setWord(w: string, nudge = true) {
  const c = clean(w);
  if (!c) return;
  word = c;
  engine.setText(c);
  if (nudge) engine.nudge();
  syncUrl();
}

const sheet = $<HTMLFormElement>('sheet');
const input = $<HTMLInputElement>('word');
let typing = 0;

function openSheet() {
  document.body.classList.add('editing');
  sheet.hidden = false;
  input.value = word;
  input.focus();
  input.select();
}
function closeSheet() {
  input.blur();
  sheet.hidden = true;
  document.body.classList.remove('editing');
  window.scrollTo(0, 0);
}
input.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => setWord(input.value), 220);
});
sheet.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(typing);
  setWord(input.value);
  closeSheet();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

// keep the sheet above the iOS keyboard
const vv = window.visualViewport;
function syncKeyboard() {
  if (!vv) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
  if (vv.offsetTop > 0) window.scrollTo(0, 0);
}
vv?.addEventListener('resize', syncKeyboard);
vv?.addEventListener('scroll', syncKeyboard);

$('bText').addEventListener('click', openSheet);
$('bTheme').addEventListener('click', () => {
  theme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  applyThemeUi(false);
  syncUrl();
});

$('bShare').addEventListener('click', async () => {
  const url = shareUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Blow', text: tr('shareText', { w: word }), url });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(tr('copied'));
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      /* ignore */
    }
    ta.remove();
    toast(ok ? tr('copied') : tr('copyFail'));
  }
});

// capture
let shotBlob: Blob | null = null;
let shotUrl = '';
$('bShot').addEventListener('click', () => {
  const snap = engine.snapshot(); // must be in the same task as the draw
  const c = snap.getContext('2d')!;
  const fs = Math.round(snap.width * 0.032);
  c.font = `600 ${fs}px ui-rounded, system-ui, sans-serif`;
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.textAlign = 'center';
  c.fillText('ysnaitoumghar.github.io/blow', snap.width / 2, snap.height - fs * 1.6);
  snap.toBlob((b) => {
    if (!b) return;
    shotBlob = b;
    if (shotUrl) URL.revokeObjectURL(shotUrl);
    shotUrl = URL.createObjectURL(b);
    $<HTMLImageElement>('shotImg').src = shotUrl;
    $('shot').hidden = false;
  }, 'image/png');
});
$('shotClose').addEventListener('click', () => {
  $('shot').hidden = true;
});
$('shotSave').addEventListener('click', async () => {
  if (!shotBlob) return;
  const file = new File([shotBlob], `blow-${word.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = shotUrl;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// simulated sensors (desktop, or when permissions are missing)
$('bBlow').addEventListener('click', () => {
  burstBlow = 1;
});
$('bShake').addEventListener('click', () => {
  engine.explode(1);
});

// ---------------------------------------------------------------- hints
let hintTimers: number[] = [];
function showHints() {
  const el = $('hint');
  const seq: string[] = [];
  if (sensors.hasMotion || sensors.hasMic) {
    seq.push(tr('hintTouch'));
    if (sensors.hasMotion) seq.push(tr('hintTilt'));
    if (sensors.hasMic) seq.push(tr('hintBlow'));
  } else if (matchMedia('(pointer: fine)').matches) {
    seq.push(tr('hintDesktop'));
  } else {
    seq.push(tr('hintTouch'));
  }
  hintTimers.forEach(clearTimeout);
  hintTimers = [];
  const step = seq.length === 1 ? 5200 : 1900;
  seq.forEach((txt, i) => {
    hintTimers.push(
      window.setTimeout(() => {
        el.textContent = txt;
        el.classList.add('on');
      }, 700 + i * step),
      window.setTimeout(() => el.classList.remove('on'), 700 + i * step + step - 500),
    );
  });
}

// ---------------------------------------------------------------- start
const startBtn = $<HTMLButtonElement>('startBtn');
startBtn.addEventListener('click', async () => {
  if (started) return;
  startBtn.disabled = true;
  // everything that needs the user gesture is kicked off synchronously
  sensors.prepareAudio();
  const motion = await sensors.requestMotion();
  // the mic prompt must not hold the scene hostage: enter now, settle the mic as it resolves
  const micP = sensors.requestMic();

  started = true;
  $('start').classList.add('gone');
  setTimeout(() => ($('start').hidden = true), 700);
  $('dock').hidden = false;
  $('bShake').hidden = motion === 'granted';
  $('bBlow').hidden = false;
  engine.explode(0.8);
  void keepAwake();

  const mic = await micP;
  $('bBlow').hidden = mic === 'granted';
  const noMotion = motion !== 'granted';
  if (noMotion && mic !== 'granted' && (motion === 'denied' || mic === 'denied')) toast(tr('touchOnly'));
  else if (motion === 'denied') toast(tr('noMotion'));
  else if (mic === 'denied') toast(tr('noMic'));
  showHints();
});

// ------------------------------------------------------ lifecycle
let wake: WakeLockSentinel | null = null;
async function keepAwake() {
  try {
    wake = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wake = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    engine.stop();
    sensors.suspend();
    engine.pointers.clear();
    keyBlow = 0;
  } else {
    engine.start();
    void sensors.resume();
    if (started) void keepAwake();
  }
});
window.addEventListener('pagehide', () => engine.stop());
window.addEventListener('pageshow', (e) => {
  if (e.persisted) engine.start();
});
window.addEventListener('blur', () => {
  keyBlow = 0;
  engine.pointers.clear();
});

let rz = 0;
function onResize() {
  clearTimeout(rz);
  rz = window.setTimeout(() => {
    engine.resize();
    syncKeyboard();
  }, 120);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => {
  onResize();
  window.setTimeout(onResize, 400); // iOS reports the new size late
});

// ----------------------------------------------------------------- boot
applyLang(initialLang, false);
applyThemeUi(true);
engine.resize();
engine.setText(word);
engine.start();
if (!sharedWord) syncUrl();

// handy for testing from the console / headless runs
(window as unknown as { __blow: unknown }).__blow = { engine, sensors };
