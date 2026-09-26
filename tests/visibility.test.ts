import { describe, it, expect, vi } from 'vitest';

// The access lists are module state, so they are mocked rather than edited.
vi.mock('../src/access.config', () => ({
  owners: () => ['the-owner', 'owner@example.com'],
  circle: () => ['trusted-friend', 'Colleague@Example.COM'],
}));

const { canView, canComment, audienceFromLists, visibleTo } = await import('../src/lib/visibility');
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

describe('canComment', () => {
  // The rule is "comment on what you can read", so a pending member — who
  // resolves to the anonymous audience — can still join a public thread.
  it('lets a signed-in stranger comment on a public post', () => {
    expect(canComment(post('public'), 'anonymous', stranger, 'pending')).toBe(true);
  });

  it('still refuses them on a circle post', () => {
    expect(canComment(post('circle'), 'anonymous', stranger, 'pending')).toBe(false);
  });

  it('still refuses them on a private post', () => {
    expect(canComment(post('private'), 'anonymous', stranger, 'pending')).toBe(false);
  });

  it('requires an identity — a comment has to attach to someone', () => {
    expect(canComment(post('public'), 'anonymous', null)).toBe(false);
  });

  // A block that does not stop commenting is not a block. Blocking resolves
  // someone to the anonymous audience, which would otherwise let them straight
  // back into public threads.
  it('refuses a blocked member everywhere, including public posts', () => {
    expect(canComment(post('public'), 'anonymous', stranger, 'blocked')).toBe(false);
    expect(canComment(post('circle'), 'circle', circleMember, 'blocked')).toBe(false);
  });

  it('lets approved members and owners comment on what they can read', () => {
    expect(canComment(post('circle'), 'circle', circleMember, 'approved')).toBe(true);
    expect(canComment(post('private'), 'owner', owner)).toBe(true);
  });

  // Drafts are owner-only, and commenting must not be a way to learn one exists.
  it('refuses everyone but an owner on a draft', () => {
    const draft = post('public', { draft: true });
    expect(canComment(draft, 'anonymous', stranger, 'pending')).toBe(false);
    expect(canComment(draft, 'circle', circleMember, 'approved')).toBe(false);
    expect(canComment(draft, 'owner', owner)).toBe(true);
  });
});
