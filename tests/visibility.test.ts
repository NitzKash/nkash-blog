import { describe, it, expect, vi } from 'vitest';

// The access lists are module state, so they are mocked rather than edited.
vi.mock('../src/access.config', () => ({
  owners: () => ['the-owner', 'owner@example.com'],
  circle: () => ['trusted-friend', 'Colleague@Example.COM'],
}));

const { canView, audienceFromLists, visibleTo } = await import('../src/lib/visibility');
type Viewer = Parameters<typeof audienceFromLists>[0];

const owner: Viewer = { sub: 'github:1', login: 'the-owner' };
const ownerByEmail: Viewer = { sub: 'github:2', email: 'owner@example.com' };
const circleMember: Viewer = { sub: 'github:3', login: 'trusted-friend' };
const circleByEmail: Viewer = { sub: 'github:4', email: 'colleague@example.com' };
const stranger: Viewer = { sub: 'github:9', login: 'rando', email: 'rando@example.com' };

const post = (visibility: string, extra = {}) =>
  ({ visibility, allow: [], draft: false, ...extra }) as never;

describe('audienceFromLists', () => {
  it('treats a missing session as anonymous', () => {
    expect(audienceFromLists(null)).toBe('anonymous');
  });

  it('recognises owners by login and by verified email', () => {
    expect(audienceFromLists(owner)).toBe('owner');
    expect(audienceFromLists(ownerByEmail)).toBe('owner');
  });

  it('matches case-insensitively', () => {
    expect(audienceFromLists({ sub: 'github:5', login: 'THE-OWNER' })).toBe('owner');
    expect(audienceFromLists(circleByEmail)).toBe('circle');
  });

  it('treats an authenticated stranger exactly like an anonymous one', () => {
    expect(audienceFromLists(stranger)).toBe('anonymous');
  });
});

describe('canView', () => {
  it('lets anyone read public posts', () => {
    expect(canView(post('public'), 'anonymous', null)).toBe(true);
    expect(canView(post('public'), 'anonymous', stranger)).toBe(true);
  });

  it('hides circle posts from strangers and anonymous visitors', () => {
    expect(canView(post('circle'), 'anonymous', null)).toBe(false);
    expect(canView(post('circle'), 'anonymous', stranger)).toBe(false);
  });

  it('shows circle posts to the circle and to owners', () => {
    expect(canView(post('circle'), 'circle', circleMember)).toBe(true);
    expect(canView(post('circle'), 'owner', owner)).toBe(true);
  });

  it('hides private posts from everyone but owners', () => {
    expect(canView(post('private'), 'anonymous', null)).toBe(false);
    expect(canView(post('private'), 'anonymous', stranger)).toBe(false);
    expect(canView(post('private'), 'circle', circleMember)).toBe(false);
    expect(canView(post('private'), 'owner', owner)).toBe(true);
  });

  it('honours a per-post grant without widening the tier', () => {
    expect(canView(post('circle', { allow: ['rando'] }), 'anonymous', stranger)).toBe(true);
    expect(canView(post('circle'), 'anonymous', stranger)).toBe(false);
  });

  it('does not let a per-post grant open a private post', () => {
    expect(canView(post('private', { allow: ['rando'] }), 'anonymous', stranger)).toBe(false);
  });

  it('never matches a grant against an anonymous viewer', () => {
    expect(canView(post('circle', { allow: ['rando'] }), 'anonymous', null)).toBe(false);
  });

  // The property that actually matters: a post whose frontmatter is wrong must
  // not become readable. The schema defaults `visibility` to private, and
  // canView refuses anything it does not recognise.
  it('fails closed on an unrecognised visibility value', () => {
    expect(canView(post('pubic'), 'anonymous', stranger)).toBe(false);
    expect(canView(post(''), 'circle', circleMember)).toBe(false);
    expect(canView(post(undefined as never), 'circle', circleMember)).toBe(false);
  });

  it('keeps drafts owner-only even when marked public', () => {
    const draft = post('public', { draft: true });
    expect(canView(draft, 'anonymous', null)).toBe(false);
    expect(canView(draft, 'anonymous', stranger)).toBe(false);
    expect(canView(draft, 'circle', circleMember)).toBe(false);
    expect(canView(draft, 'owner', owner)).toBe(true);
  });

  it('ignores an empty identity rather than matching an empty list entry', () => {
    expect(canView(post('circle'), 'anonymous', { sub: 'github:0' })).toBe(false);
  });

  // A tampered or stale audience must not be able to widen a private post
  // beyond what the tier allows.
  it('gives circle members nothing extra on private posts', () => {
    expect(canView(post('private', { allow: ['trusted-friend'] }), 'circle', circleMember)).toBe(
      false,
    );
  });
});

describe('visibleTo', () => {
  const posts = [
    { data: post('public') },
    { data: post('circle') },
    { data: post('private') },
    { data: post('public', { draft: true }) },
  ];

  it('gives an anonymous reader only the published public posts', () => {
    expect(visibleTo(posts as never, 'anonymous', null)).toHaveLength(1);
  });

  it('gives the circle two', () => {
    expect(visibleTo(posts as never, 'circle', circleMember)).toHaveLength(2);
  });

  it('gives the owner everything', () => {
    expect(visibleTo(posts as never, 'owner', owner)).toHaveLength(4);
  });
});
