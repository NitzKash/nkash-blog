import { describe, it, expect, vi } from 'vitest';

// The access lists are module state, so they are mocked rather than edited.
vi.mock('../src/access.config', () => ({
  owners: () => ['the-owner', 'owner@example.com'],
  circle: () => ['trusted-friend', 'Colleague@Example.COM'],
}));

const { canView, canComment, canEdit, canDelete, isAuthor, audienceFromLists, visibleTo } =
  await import('../src/lib/visibility');
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

// ---------------------------------------------------------------------------
// Multiple authors. `private` means the author alone, which is a different
// thing from what it meant when every post was the owner's.
// ---------------------------------------------------------------------------

const authored = (visibility: string, authorId: string | null, extra = {}) =>
  ({ visibility, allow: [], draft: false, authorId, ...extra }) as never;

const alice: Viewer = { sub: 'github:100', login: 'alice' };
const bob: Viewer = { sub: 'github:200', login: 'bob' };

describe('isAuthor', () => {
  it('matches on the provider subject, not the handle', () => {
    expect(isAuthor(authored('private', 'github:100'), alice)).toBe(true);
    expect(isAuthor(authored('private', 'github:100'), bob)).toBe(false);
  });

  it('is false for an unattributed post and for anonymous viewers', () => {
    expect(isAuthor(authored('private', null), alice)).toBe(false);
    expect(isAuthor(authored('private', 'github:100'), null)).toBe(false);
  });
});

describe('canView with authors', () => {
  // 'circle' is an author in good standing. Passing 'anonymous' here would be
  // a removed member, which is covered in its own block further down.
  it('lets an author in good standing read their own post at any tier', () => {
    for (const tier of ['public', 'circle', 'private']) {
      expect(canView(authored(tier, 'github:100'), 'circle', alice), tier).toBe(true);
    }
  });

  it('lets an author in good standing read their own draft', () => {
    expect(canView(authored('public', 'github:100', { draft: true }), 'circle', alice)).toBe(true);
  });

  // The property this whole change turns on.
  it('hides a contributor private post from the owner', () => {
    expect(canView(authored('private', 'github:100'), 'owner', owner)).toBe(false);
  });

  it('hides a contributor private post from another contributor', () => {
    expect(canView(authored('private', 'github:100'), 'circle', bob)).toBe(false);
  });

  it('hides a contributor draft from the owner', () => {
    expect(canView(authored('circle', 'github:100', { draft: true }), 'owner', owner)).toBe(false);
  });

  // Unattributed posts predate authorship and stay the owner's.
  it('keeps unattributed private posts owner-only', () => {
    expect(canView(authored('private', null), 'owner', owner)).toBe(true);
    expect(canView(authored('private', null), 'circle', alice)).toBe(false);
    expect(canView(authored('private', null), 'anonymous', null)).toBe(false);
  });

  it('still shows contributor circle posts to the circle and the owner', () => {
    expect(canView(authored('circle', 'github:100'), 'circle', bob)).toBe(true);
    expect(canView(authored('circle', 'github:100'), 'owner', owner)).toBe(true);
    expect(canView(authored('circle', 'github:100'), 'anonymous', null)).toBe(false);
  });

  it('still shows contributor public posts to everyone', () => {
    expect(canView(authored('public', 'github:100'), 'anonymous', null)).toBe(true);
  });
});

describe('canEdit', () => {
  it('lets an author edit their own', () => {
    expect(canEdit(authored('public', 'github:100'), 'circle', alice)).toBe(true);
  });

  // Narrower than reading on purpose: an owner can read a contributor's circle
  // post but must not be able to rewrite it under their name.
  it('refuses the owner on a contributor post they can read', () => {
    expect(canView(authored('circle', 'github:100'), 'owner', owner)).toBe(true);
    expect(canEdit(authored('circle', 'github:100'), 'owner', owner)).toBe(false);
  });

  it('refuses one contributor on another contributor post', () => {
    expect(canEdit(authored('public', 'github:100'), 'circle', bob)).toBe(false);
  });

  it('lets the owner edit unattributed posts', () => {
    expect(canEdit(authored('public', null), 'owner', owner)).toBe(true);
    expect(canEdit(authored('public', null), 'circle', alice)).toBe(false);
  });

  it('refuses anonymous viewers outright', () => {
    expect(canEdit(authored('public', 'github:100'), 'anonymous', null)).toBe(false);
  });
});

describe('canDelete', () => {
  // Moderating your own site means being able to take something down, even
  // something you may not rewrite.
  it('lets the owner remove anything', () => {
    expect(canDelete(authored('private', 'github:100'), 'owner', owner)).toBe(true);
  });

  it('lets an author remove their own', () => {
    expect(canDelete(authored('public', 'github:100'), 'circle', alice)).toBe(true);
  });

  it('refuses one contributor on another contributor post', () => {
    expect(canDelete(authored('public', 'github:100'), 'circle', bob)).toBe(false);
  });
});

describe('visibleTo with authors', () => {
  const mixed = [
    { data: authored('public', 'github:100') },
    { data: authored('circle', 'github:100') },
    { data: authored('private', 'github:100') },
    { data: authored('private', 'github:200') },
    { data: authored('private', null) },
  ];

  it('gives alice public, circle and her own private — not bob\'s', () => {
    expect(visibleTo(mixed as never, 'circle', alice)).toHaveLength(3);
  });

  it('gives the owner public, circle and the unattributed one only', () => {
    expect(visibleTo(mixed as never, 'owner', owner)).toHaveLength(3);
  });

  it('gives an anonymous reader the public one', () => {
    expect(visibleTo(mixed as never, 'anonymous', null)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Standing. Writing something does not entitle you to it forever — a removed
// or blocked member resolves to the anonymous audience, and their private work
// is archived rather than inherited.
// ---------------------------------------------------------------------------

describe('a removed or blocked author', () => {
  const removed = alice; // resolves to the anonymous audience once removed

  it('loses access to their own private posts', () => {
    expect(canView(authored('private', 'github:100'), 'circle', alice)).toBe(true);
    expect(canView(authored('private', 'github:100'), 'anonymous', removed)).toBe(false);
  });

  it('loses access to their own drafts', () => {
    const draft = authored('public', 'github:100', { draft: true });
    expect(canView(draft, 'circle', alice)).toBe(true);
    expect(canView(draft, 'anonymous', removed)).toBe(false);
  });

  it('loses access to their own circle posts, like any other outsider', () => {
    expect(canView(authored('circle', 'github:100'), 'anonymous', removed)).toBe(false);
  });

  // Published work stays published. Taking it down would be editing the site's
  // history rather than revoking one person's access.
  it('keeps their public posts readable by everyone', () => {
    expect(canView(authored('public', 'github:100'), 'anonymous', removed)).toBe(true);
    expect(canView(authored('public', 'github:100'), 'anonymous', null)).toBe(true);
  });

  it('can no longer edit anything of their own', () => {
    expect(canEdit(authored('public', 'github:100'), 'circle', alice)).toBe(true);
    expect(canEdit(authored('public', 'github:100'), 'anonymous', removed)).toBe(false);
  });

  it('is still invisible to everyone else, as before', () => {
    expect(canView(authored('private', 'github:100'), 'owner', owner)).toBe(false);
    expect(canView(authored('private', 'github:100'), 'circle', bob)).toBe(false);
  });

  // The owner keeps their own access regardless — their audience is 'owner'.
  it('does not affect the owner reading their own private posts', () => {
    expect(canView(authored('private', null), 'owner', owner)).toBe(true);
  });
});
