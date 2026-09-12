/**
 * Handles.
 *
 * The point of a handle here is that a reader does not have to carry their
 * GitHub login or their work email around the site just because that is what
 * they signed in with. So the suggestion generator matters more than it looks:
 * a good default is what makes someone take the option rather than shrug and
 * keep their real name.
 */

const ADJECTIVES = [
  'quiet', 'stray', 'idle', 'dense', 'lossy', 'silent', 'drifting', 'spare',
  'hollow', 'slow', 'deep', 'thin', 'patient', 'stubborn', 'crooked', 'faint',
  'restless', 'humming', 'unbuffered', 'lucid', 'stale', 'eager', 'warm',
];

const NOUNS = [
  'wafer', 'photon', 'lattice', 'packet', 'buffer', 'isotope', 'kernel',
  'spindle', 'vertex', 'quorum', 'shard', 'epoch', 'cache', 'raster', 'anode',
  'bitmap', 'substrate', 'heuristic', 'gradient', 'daemon', 'octet', 'lumen',
];

/** Names the site or its routes need for itself. */
const RESERVED = new Set([
  'nkash', 'admin', 'administrator', 'root', 'owner', 'moderator', 'system',
  'anonymous', 'api', 'auth', 'login', 'logout', 'welcome', 'posts', 'post',
  'projects', 'rss', 'sitemap', 'robots', 'me', 'you', 'null', 'undefined',
]);

const MIN = 3;
const MAX = 24;

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/** e.g. `quiet-wafer`, `stray-photon-41`. */
export function suggest(): string {
  const base = `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
  // A number roughly a third of the time — enough to make collisions unlikely
  // without making every suggestion look machine-generated.
  return Math.random() < 0.34 ? `${base}-${Math.floor(Math.random() * 90) + 10}` : base;
}

export function normalise(input: string): string {
  return input.trim().toLowerCase();
}

export type UsernameError =
  | 'too-short'
  | 'too-long'
  | 'charset'
  | 'start'
  | 'end'
  | 'double-hyphen'
  | 'reserved';

export const MESSAGES: Record<UsernameError, string> = {
  'too-short': `At least ${MIN} characters.`,
  'too-long': `At most ${MAX} characters.`,
  charset: 'Letters, numbers and single hyphens only.',
  start: 'Has to start with a letter.',
  end: "Can't end with a hyphen.",
  'double-hyphen': 'No doubled hyphens.',
  reserved: 'That one is taken by the site itself.',
};

/** Returns null when the handle is fine, or the first problem with it. */
export function validate(input: string): UsernameError | null {
  const value = normalise(input);

  if (value.length < MIN) return 'too-short';
  if (value.length > MAX) return 'too-long';
  if (!/^[a-z0-9-]+$/.test(value)) return 'charset';
  if (!/^[a-z]/.test(value)) return 'start';
  if (value.endsWith('-')) return 'end';
  if (value.includes('--')) return 'double-hyphen';
  if (RESERVED.has(value)) return 'reserved';

  return null;
}
