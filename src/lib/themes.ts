export type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface Theme {
  stops: [RGB, RGB, RGB];
  bg: RGB;
  accent: string;
  /** two CSS colors used for the theme button swatch */
  swatch: [string, string];
}

export const THEME_ORDER = ['warm', 'electric', 'mono', 'sunset'] as const;
export type ThemeName = (typeof THEME_ORDER)[number];

export const THEMES: Record<ThemeName, Theme> = {
  warm: {
    stops: [hex('#ffd467'), hex('#ffa31f'), hex('#ff6a1a')],
    bg: hex('#0a0604'),
    accent: '#ffc247',
    swatch: ['#ffd467', '#ff6a1a'],
  },
  electric: {
    stops: [hex('#2fe6ff'), hex('#5b86ff'), hex('#b05bff')],
    bg: hex('#03050f'),
    accent: '#6fdcff',
    swatch: ['#2fe6ff', '#b05bff'],
  },
  mono: {
    stops: [hex('#ffffff'), hex('#dfe7f5'), hex('#aab4c8')],
    bg: hex('#050506'),
    accent: '#ffffff',
    swatch: ['#ffffff', '#8a93a6'],
  },
  sunset: {
    stops: [hex('#ff4f9a'), hex('#ff6f61'), hex('#ffb347')],
    bg: hex('#090409'),
    accent: '#ff7fa6',
    swatch: ['#ff4f9a', '#ffb347'],
  },
};

export function isTheme(s: unknown): s is ThemeName {
  return typeof s === 'string' && (THEME_ORDER as readonly string[]).includes(s);
}
