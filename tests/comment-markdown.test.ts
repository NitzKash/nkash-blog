import { describe, it, expect } from 'vitest';
import {
  renderComment,
  escapeHtml,
  validateComment,
  MAX_COMMENT_LENGTH,
} from '../src/lib/comment-markdown';

/**
 * Comments are the only untrusted HTML on the site. These tests are the reason
 * that is acceptable, so they are deliberately adversarial: every case here is
 * something an approved-but-malicious member could type into the box.
 */

describe('escaping', () => {
  it('neutralises every character that can open markup', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('escapes ampersands before anything else, so entities cannot be forged', () => {
    // If & were escaped last, `&lt;script&gt;` typed literally would become a
    // real tag after the other replacements ran.
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });
});

/**
 * Extracts the tags the renderer actually emitted.
 *
 * Asserting "the output does not contain the string onerror" is the wrong
 * test: escaped text legitimately contains it, harmlessly, because `<` became
 * `&lt;` and the browser will draw it rather than parse it. What matters is
 * which tags and attributes genuinely reach the DOM, so that is what this
 * pulls out.
 */
function emittedTags(html: string): { name: string; attrs: string[] }[] {
  return [...html.matchAll(/<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)].map((m) => ({
    name: m[1]!.toLowerCase(),
    attrs: [...(m[2] ?? '').matchAll(/([\w-]+)=/g)].map((a) => a[1]!.toLowerCase()),
  }));
}

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'code', 'a']);
const ALLOWED_ATTRS = new Set(['href', 'rel', 'target']);

describe('renderComment — script injection', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="https://evil.example.com"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    '<body onload=alert(1)>',
    '<style>body{display:none}</style>',
    '<link rel=stylesheet href=//evil.example.com>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example.com">',
    '"><script>alert(1)</script>',
    "'><img src=x onerror=alert(1)>",
    '<form action="https://evil.example.com"><input name=p></form>',
    '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>',
  ];

  for (const attack of attacks) {
    it(`renders ${attack.slice(0, 44)} inert`, () => {
      const html = renderComment(attack);

      // Every tag that survived must be one the renderer chose to emit.
      for (const tag of emittedTags(html)) {
        expect(ALLOWED_TAGS, `tag <${tag.name}> from ${JSON.stringify(attack)}`).toContain(tag.name);
        for (const attr of tag.attrs) {
          expect(ALLOWED_ATTRS, `attribute ${attr} from ${JSON.stringify(attack)}`).toContain(attr);
        }
      }

      // And the dangerous parts survive only as escaped text, never as markup.
      if (/onerror|onload|javascript:/i.test(attack)) {
        expect(html).toMatch(/&lt;|&quot;|&#39;/);
      }
    });
  }

  it('never emits an attribute the renderer did not author', () => {
    const html = renderComment('<a href="x" onmouseover="steal()">hi</a>');
    for (const tag of emittedTags(html)) {
      for (const attr of tag.attrs) {
        expect(ALLOWED_ATTRS).toContain(attr);
      }
    }
  });

  it('emits only a paragraph wrapper for pure markup input', () => {
    const names = new Set(emittedTags(renderComment('<svg/onload=alert(1)>')).map((t) => t.name));
    expect([...names]).toEqual(['p']);
  });
});

describe('renderComment — link handling', () => {
  it('linkifies bare http and https URLs', () => {
    const html = renderComment('see https://nkash.dev for more');
    expect(html).toContain('href="https://nkash.dev"');
  });

  it('marks links nofollow ugc noopener', () => {
    const html = renderComment('https://example.com');
    expect(html).toContain('rel="nofollow ugc noopener"');
  });

  // The scheme allowlist, not the escaping, is what makes these safe.
  it('refuses to linkify dangerous schemes', () => {
    for (const source of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      const html = renderComment(source);
      expect(html).not.toContain('<a ');
    }
  });

  it('does not swallow sentence punctuation into the href', () => {
    const html = renderComment('go to https://nkash.dev.');
    expect(html).toContain('href="https://nkash.dev"');
    expect(html).not.toContain('href="https://nkash.dev."');
  });

  it('truncates the visible text of a very long URL', () => {
    const long = `https://example.com/${'a'.repeat(200)}`;
    const html = renderComment(long);
    expect(html).toContain('…');
    expect(html).toContain(`href="${long}"`);
  });
});

describe('renderComment — formatting', () => {
  it('supports bold, italic and code', () => {
    expect(renderComment('**b**')).toContain('<strong>b</strong>');
    expect(renderComment('*i*')).toContain('<em>i</em>');
    expect(renderComment('`c`')).toContain('<code>c</code>');
  });

  it('does not format inside code spans', () => {
    const html = renderComment('`**not bold** https://example.com`');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<a ');
    expect(html).toContain('<code>');
  });

  it('keeps markup typed inside a code span as literal text', () => {
    const html = renderComment('`<script>alert(1)</script>`');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script/i);
  });

  it('splits paragraphs on blank lines and keeps single newlines as breaks', () => {
    const html = renderComment('one\ntwo\n\nthree');
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain('<br />');
  });

  it('supports nothing else — no headings, images or tables', () => {
    const html = renderComment('# heading\n\n![img](x.png)\n\n| a | b |');
    expect(html).not.toMatch(/<h1|<img|<table/i);
  });

  it('returns empty for empty or whitespace-only input', () => {
    expect(renderComment('')).toBe('');
    expect(renderComment('   \n\n  ')).toBe('');
  });
});

describe('validateComment', () => {
  it('rejects empty and whitespace-only', () => {
    expect(validateComment('')).toBe('empty');
    expect(validateComment('   ')).toBe('empty');
  });

  it('rejects anything over the cap', () => {
    expect(validateComment('a'.repeat(MAX_COMMENT_LENGTH + 1))).toBe('too-long');
    expect(validateComment('a'.repeat(MAX_COMMENT_LENGTH))).toBeNull();
  });

  it('accepts ordinary text', () => {
    expect(validateComment('Nice post. The batching bit surprised me.')).toBeNull();
  });
});

describe('renderComment — output is always well-formed', () => {
  it('never produces an unbalanced tag from adversarial input', () => {
    for (const source of ['<<<>>>', '***', '```', '**a', '`b', '<p', 'a<b>c']) {
      const html = renderComment(source);
      const opens = (html.match(/<(p|strong|em|code|a)\b/g) ?? []).length;
      const closes = (html.match(/<\/(p|strong|em|code|a)>/g) ?? []).length;
      expect(opens, `for ${JSON.stringify(source)}`).toBe(closes);
    }
  });
});
