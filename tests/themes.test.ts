import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEMES, isTheme, DEFAULT_THEME } from '../src/lib/themes';

/**
 * Contrast is checked here rather than by eye because a palette that looks
 * pleasant on a good monitor in a dark room can still be unreadable for
 * someone with low vision. The numbers are the whole point — adding a theme
 * without running them is how a site quietly becomes unusable for people who
 * never complain, they just leave.
 */

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function tokensFor(themeId: string): Record<string, string> {
  const block =
    themeId === 'auto'
      ? css.split(':root {')[1]?.split('}')[0]
      : css.match(new RegExp(`\\[data-theme='${themeId}'\\] \\{(.*?)\\}`, 's'))?.[1];

  return Object.fromEntries(
    [...(block ?? '').matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]),
  );
}

describe('theme registry', () => {
  it('has a palette in the stylesheet for every theme except auto', () => {
    for (const theme of THEMES) {
      if (theme.id === 'auto') continue;
      expect(css, theme.id).toContain(`[data-theme='${theme.id}']`);
    }
  });

  it('defines every token each palette needs, so none fall back silently', () => {
    const required = ['bg', 'bg-raised', 'border', 'text', 'text-dim', 'text-faint', 'accent', 'warn', 'lock'];
    for (const theme of THEMES) {
      if (theme.id === 'auto') continue;
      const tokens = tokensFor(theme.id);
      for (const name of required) {
        expect(tokens[name], `${theme.id} is missing --${name}`).toBeTruthy();
      }
    }
  });

  it('defaults to auto, which is the absence of an attribute', () => {
    expect(DEFAULT_THEME).toBe('auto');
    expect(css).not.toContain("[data-theme='auto']");
  });

  it('rejects a stale or hand-edited stored value', () => {
    expect(isTheme('rose')).toBe(true);
    expect(isTheme('neon')).toBe(false);
    expect(isTheme('')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe('contrast — WCAG AA', () => {
  const ids = ['auto', ...THEMES.filter((t) => t.id !== 'auto').map((t) => t.id)];

  for (const id of ids) {
    describe(id, () => {
      const tokens = tokensFor(id);

      // 4.5:1 is the AA threshold for body-sized text.
      it('body text reaches 4.5:1 against the background', () => {
        expect(contrast(tokens.bg!, tokens.text!)).toBeGreaterThanOrEqual(4.5);
      });

      it('secondary text reaches 4.5:1', () => {
        expect(contrast(tokens.bg!, tokens['text-dim']!)).toBeGreaterThanOrEqual(4.5);
      });

      // Links carry meaning, so they are held to the text threshold rather
      // than the 3:1 allowed for large text and UI components.
      it('links reach 4.5:1', () => {
        expect(contrast(tokens.bg!, tokens.accent!)).toBeGreaterThanOrEqual(4.5);
      });

      // Faint text is metadata — dates, counts. 3:1 is the floor it must clear.
      it('faint text reaches at least 3:1', () => {
        expect(contrast(tokens.bg!, tokens['text-faint']!)).toBeGreaterThanOrEqual(3);
      });

      it('raised surfaces stay distinguishable from the page', () => {
        expect(contrast(tokens.bg!, tokens['bg-raised']!)).toBeGreaterThan(1.02);
      });

      it('body text still reads on a raised surface', () => {
        expect(contrast(tokens['bg-raised']!, tokens.text!)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});

describe('switcher swatches', () => {
  // The dots are the only way to tell Rose from Sand at a glance, so the two
  // halves of each must actually differ.
  it('every swatch contrasts with its own accent wedge', () => {
    for (const theme of THEMES) {
      expect(contrast(theme.swatch, theme.ink), theme.id).toBeGreaterThan(1.5);
    }
  });

  it('each theme has a distinct swatch', () => {
    const swatches = THEMES.map((t) => `${t.swatch}${t.ink}`);
    expect(new Set(swatches).size).toBe(THEMES.length);
  });
});
