import { describe, it, expect } from 'vitest';
import { slugify, excerpt, readingMinutes, renderMarkdown } from '../src/lib/markdown';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Batching on the Wafer Line')).toBe('batching-on-the-wafer-line');
  });

  it('strips punctuation and collapses runs', () => {
    expect(slugify('p99 — throughput vs. latency!!')).toBe('p99-throughput-vs-latency');
  });

  it('strips accents rather than dropping the letter', () => {
    expect(slugify('Café résumé')).toBe('cafe-resume');
  });

  it('has no leading or trailing hyphens', () => {
    expect(slugify('  ...hello...  ')).toBe('hello');
  });

  // A title that reduces to nothing must be reported, not silently turned into
  // an empty or meaningless URL — the caller asks for a slug by hand instead.
  it('returns empty for a title with nothing sluggable in it', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('🎉🎉🎉')).toBe('');
  });

  it('caps length so a long title cannot produce an unusable URL', () => {
    expect(slugify('word '.repeat(100)).length).toBeLessThanOrEqual(80);
  });
});

describe('excerpt', () => {
  it('takes the first paragraph', () => {
    expect(excerpt('First paragraph here.\n\nSecond one.')).toBe('First paragraph here.');
  });

  it('keeps link text and drops the URL', () => {
    expect(excerpt('A [link](https://nkash.dev) and more.')).toBe('A link and more.');
  });

  it('drops images entirely', () => {
    expect(excerpt('![a chart](/chart.png) Text after.')).toBe('Text after.');
  });

  it('skips headings and fenced code', () => {
    expect(excerpt('# Title\n\n```js\nconst x = 1;\n```\n\nThe real opening.')).toBe(
      'The real opening.',
    );
  });

  it('truncates with an ellipsis', () => {
    const long = 'word '.repeat(80);
    const result = excerpt(long, 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty rather than throwing on empty input', () => {
    expect(excerpt('')).toBe('');
  });
});

describe('readingMinutes', () => {
  it('floors at one minute', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('three short words')).toBe(1);
  });

  it('scales at roughly 220 words per minute', () => {
    expect(readingMinutes('word '.repeat(1100))).toBe(5);
  });
});

describe('renderMarkdown', () => {
  it('renders headings, links and code', async () => {
    const html = await renderMarkdown('## Heading\n\n[link](https://x.dev)\n\n`code`');
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('href="https://x.dev"');
    expect(html).toContain('<code>code</code>');
  });

  it('renders fenced code blocks with a language class', async () => {
    const html = await renderMarkdown('```sql\nSELECT 1;\n```');
    expect(html).toContain('language-sql');
  });

  it('handles empty input', async () => {
    expect(await renderMarkdown('')).toBe('');
  });
});
