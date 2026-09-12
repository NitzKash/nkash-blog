import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/access.config', () => ({
  owners: () => ['the-owner'],
  circle: () => ['listed-friend'],
}));

const memberGet = vi.fn();
const memberRecord = vi.fn();

vi.mock('../src/lib/data/members', () => ({
  get: (...args: unknown[]) => memberGet(...args),
  record: (...args: unknown[]) => memberRecord(...args),
}));

const { resolveMembership, recordSignIn } = await import('../src/lib/membership');

beforeEach(() => {
  memberGet.mockReset();
  memberRecord.mockReset();
});

const member = (status: string) => ({ id: 'github:9', status });

describe('resolveMembership', () => {
  it('never touches the database for an anonymous visitor', async () => {
    expect(await resolveMembership(null)).toEqual({ audience: 'anonymous' });
    expect(memberGet).not.toHaveBeenCalled();
  });

  // The env lists are the bootstrap: an owner has to get in even if the
  // database is empty or broken, so they must not require a lookup.
  it('resolves owners from the env list without a lookup', async () => {
    const result = await resolveMembership({ sub: 'github:1', login: 'the-owner' });
    expect(result.audience).toBe('owner');
    expect(memberGet).not.toHaveBeenCalled();
  });

  it('resolves env-listed circle members without a lookup', async () => {
    const result = await resolveMembership({ sub: 'github:2', login: 'listed-friend' });
    expect(result.audience).toBe('circle');
    expect(memberGet).not.toHaveBeenCalled();
  });

  it('promotes an approved member to the circle', async () => {
    memberGet.mockResolvedValue(member('approved'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'circle',
      status: 'approved',
    });
  });

  it('gives a pending member exactly what a stranger gets', async () => {
    memberGet.mockResolvedValue(member('pending'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'anonymous',
      status: 'pending',
    });
  });

  it('gives a blocked member exactly what a stranger gets', async () => {
    memberGet.mockResolvedValue(member('blocked'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'anonymous',
      status: 'blocked',
    });
  });

  it('reports someone with no row yet as pending', async () => {
    memberGet.mockResolvedValue(null);
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'anonymous',
      status: 'pending',
    });
  });

  // The important failure mode: a broken database must deny, not promote.
  it('degrades to anonymous when the lookup throws', async () => {
    memberGet.mockRejectedValue(new Error('D1 unavailable'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({ audience: 'anonymous' });
  });

  it('still lets an owner in when the database is down', async () => {
    memberGet.mockRejectedValue(new Error('D1 unavailable'));
    const result = await resolveMembership({ sub: 'github:1', login: 'the-owner' });
    expect(result.audience).toBe('owner');
  });
});

describe('recordSignIn', () => {
  it('records the viewer', async () => {
    memberRecord.mockResolvedValue(undefined);
    await recordSignIn({ sub: 'github:9', login: 'rando' });
    expect(memberRecord).toHaveBeenCalledWith({ sub: 'github:9', login: 'rando' });
  });

  // Sign-in must succeed even if the queue write fails; the person simply
  // does not appear in the approval list until they come back.
  it('does not throw when the write fails', async () => {
    memberRecord.mockRejectedValue(new Error('D1 unavailable'));
    await expect(recordSignIn({ sub: 'github:9' })).resolves.toBeUndefined();
  });
});
