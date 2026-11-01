export const LANGS = ['en', 'fr', 'ar'] as const;
export type Lang = (typeof LANGS)[number];

type Dict = Record<string, string>;

const dict: Record<Lang, Dict> = {
  en: {
    tagline: 'Type a word. Blow it away.',
    shared: 'Someone sent you this. Tap, tilt and blow.',
    start: 'Start',
    privacy: 'The microphone only detects blowing. Nothing is recorded or sent.',
    hintTouch: 'touch',
    hintTilt: 'tilt',
    hintBlow: 'blow',
    hintDesktop: 'move the mouse · hold B to blow · Space to shake',
    text: 'Change text',
    theme: 'Change theme',
    share: 'Share',
    capture: 'Capture',
    blow: 'Blow',
    shake: 'Shake',
    language: 'Language',
    placeholder: 'Your word',
    done: 'Done',
    copied: 'Link copied',
    copyFail: 'Could not copy the link',
    touchOnly: 'Touch only — motion and microphone are off',
    noMotion: 'Motion is off — touch still works',
    noMic: 'Microphone unavailable — touch still works',
    save: 'Save',
    close: 'Close',
    shareText: '“{w}” — tap, tilt and blow.',
  },
  fr: {
    tagline: 'Écris un mot. Souffle dessus.',
    shared: 'Quelqu’un t’a envoyé ça. Touche, incline et souffle.',
    start: 'Commencer',
    privacy: 'Le micro sert uniquement à détecter le souffle. Rien n’est enregistré ni envoyé.',
    hintTouch: 'touche',
    hintTilt: 'incline',
    hintBlow: 'souffle',
    hintDesktop: 'bouge la souris · maintiens B pour souffler · Espace pour secouer',
    text: 'Changer le texte',
    theme: 'Changer le thème',
    share: 'Partager',
    capture: 'Capturer',
    blow: 'Souffler',
    shake: 'Secouer',
    language: 'Langue',
    placeholder: 'Ton mot',
    done: 'OK',
    copied: 'Lien copié',
    copyFail: 'Impossible de copier le lien',
    touchOnly: 'Tactile uniquement — mouvement et micro désactivés',
    noMotion: 'Mouvement désactivé — le tactile fonctionne',
    noMic: 'Micro indisponible — le tactile fonctionne',
    save: 'Enregistrer',
    close: 'Fermer',
    shareText: '« {w} » — touche, incline et souffle.',
  },
  ar: {
    tagline: 'اكتب كلمة، ثم انفخ عليها.',
    shared: 'أرسل لك أحدهم هذا. المس، أمِل، وانفخ.',
    start: 'ابدأ',
    privacy: 'يُستخدم الميكروفون فقط لاكتشاف النفخ. لا يتم تسجيل أو إرسال أي شيء.',
    hintTouch: 'المس',
    hintTilt: 'أمِل',
    hintBlow: 'انفخ',
    hintDesktop: 'حرّك الفأرة · اضغط B للنفخ · مسافة للهز',
    text: 'تغيير النص',
    theme: 'تغيير اللون',
    share: 'مشاركة',
    capture: 'التقاط',
    blow: 'نفخ',
    shake: 'هز',
    language: 'اللغة',
    placeholder: 'كلمتك',
    done: 'تم',
    copied: 'تم نسخ الرابط',
    copyFail: 'تعذّر نسخ الرابط',
    touchOnly: 'اللمس فقط — الحركة والميكروفون متوقفان',
    noMotion: 'الحركة متوقفة — اللمس يعمل',
    noMic: 'الميكروفون غير متاح — اللمس يعمل',
    save: 'حفظ',
    close: 'إغلاق',
    shareText: '«{w}» — المس، أمِل، وانفخ.',
  },
};

let current: Lang = 'en';

export function isLang(s: unknown): s is Lang {
  return typeof s === 'string' && (LANGS as readonly string[]).includes(s);
}

export function detectLang(): Lang {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return isLang(nav) ? nav : 'en';
}

export function getLang(): Lang {
  return current;
}

export function tr(key: string, vars?: Record<string, string>): string {
  let s = dict[current][key] ?? dict.en[key] ?? key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

export function setLang(l: Lang): void {
  current = l;
  const root = document.documentElement;
  root.lang = l;
  root.dir = l === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = tr(el.dataset.i18n!);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((el) => {
    el.setAttribute('aria-label', tr(el.dataset.i18nLabel!));
    el.setAttribute('title', tr(el.dataset.i18nLabel!));
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    el.placeholder = tr(el.dataset.i18nPh!);
  });
}
