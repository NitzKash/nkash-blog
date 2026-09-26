/**
 * Colour themes.
 *
 * A theme is a complete palette, not a light/dark switch. `auto` is the
 * default and is the absence of a `data-theme` attribute — it follows the
 * operating system, so a reader who never touches the switcher gets something
 * appropriate to their machine rather than whatever the author preferred.
 *
 * Every theme is expressed purely as overrides of the tokens in global.css.
 * Nothing in a component knows which one is active, so adding a palette is a
 * block of colours rather than a stylesheet.
 *
 * `swatch` and `ink` drive the switcher's dots. They are picked from the
 * palette itself so the control cannot drift out of sync with the theme.
 */

export const THEMES = [
  { id: 'auto', label: 'Auto', hint: 'Follows your system', swatch: '#6b7280', ink: '#e6e4e0' },
  { id: 'midnight', label: 'Midnight', hint: 'Deep indigo, violet accent', swatch: '#0d0b14', ink: '#a78bfa' },
  { id: 'forest', label: 'Forest', hint: 'Near-black green, sage accent', swatch: '#0b100d', ink: '#7fc99a' },
  { id: 'rose', label: 'Rose', hint: 'Warm blush, deep plum text', swatch: '#fdf2f5', ink: '#b8336a' },
  { id: 'sand', label: 'Sand', hint: 'Warm paper, ink brown', swatch: '#faf6ef', ink: '#9a5b2c' },
  { id: 'mono', label: 'Mono', hint: 'High-contrast greyscale', swatch: '#ffffff', ink: '#111111' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'auto';
export const THEME_STORAGE_KEY = 'nkash-theme';

/** Guards against a stale or hand-edited localStorage value. */
export function isTheme(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((t) => t.id === value);
}
