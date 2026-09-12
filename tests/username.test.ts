import { describe, it, expect } from 'vitest';
import { suggest, validate, normalise, MESSAGES } from '../src/lib/username';

describe('validate', () => {
  it('accepts ordinary handles', () => {
    for (const name of ['quiet-wafer', 'nk', 'abc', 'a1', 'stray-photon-41', 'x'.repeat(24)]) {
      const result = validate(name);
      if (name.length >= 3) expect(result, name).toBeNull();
    }
  });

  it('enforces length', () => {
    expect(validate('ab')).toBe('too-short');
    expect(validate('a'.repeat(25))).toBe('too-long');
  });

  it('rejects characters that would break a URL or read ambiguously', () => {
    expect(validate('hello world')).toBe('charset');
    expect(validate('hello_world')).toBe('charset');
    expect(validate('hello.world')).toBe('charset');
    expect(validate('héllo')).toBe('charset');
    expect(validate('<script>')).toBe('charset');
  });

  it('requires a leading letter', () => {
    expect(validate('1abc')).toBe('start');
    // A leading hyphen is inside the allowed charset, so it fails the
    // leading-letter rule rather than the charset one.
    expect(validate('-abc')).toBe('start');
  });

  it('rejects trailing and doubled hyphens', () => {
    expect(validate('abc-')).toBe('end');
    expect(validate('ab--cd')).toBe('double-hyphen');
  });

  it('refuses names the site needs for itself', () => {
    for (const name of ['nkash', 'admin', 'posts', 'auth', 'welcome', 'anonymous']) {
      expect(validate(name), name).toBe('reserved');
    }
  });

  // Case-folding happens before the reserved check, or `NKASH` walks straight
  // through it.
  it('applies reserved names case-insensitively', () => {
    expect(validate('NKASH')).toBe('reserved');
    expect(validate('Admin')).toBe('reserved');
  });

  it('has a message for every failure it can return', () => {
    const problems = [
      validate('ab'),
      validate('a'.repeat(25)),
      validate('a b'),
      validate('1a'),
      validate('ab-'),
      validate('a--b'),
      validate('admin'),
    ];
    for (const problem of problems) {
      expect(problem).not.toBeNull();
      expect(MESSAGES[problem!]).toBeTruthy();
    }
  });
});

describe('normalise', () => {
  it('lowercases and trims', () => {
    expect(normalise('  Quiet-Wafer  ')).toBe('quiet-wafer');
  });
});

describe('suggest', () => {
  it('always produces something that passes validation', () => {
    for (let i = 0; i < 500; i++) {
      const name = suggest();
      expect(validate(name), name).toBeNull();
    }
  });

  it('produces varied suggestions rather than the same one', () => {
    const seen = new Set(Array.from({ length: 50 }, () => suggest()));
    expect(seen.size).toBeGreaterThan(20);
  });
});
