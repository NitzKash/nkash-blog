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

const member = (status: string, username?: string) => ({ id: 'github:9', status, username });

describe('resolveMembership', () => {
  it('never touches the database for an anonymous visitor', async () => {
    expect(await resolveMembership(null)).toEqual({ audience: 'anonymous', needsUsername: false });
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
    memberGet.mockResolvedValue(member('approved', 'quiet-wafer'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'circle',
      status: 'approved',
      username: 'quiet-wafer',
      needsUsername: false,
    });
  });

  it('gives a pending member exactly what a stranger gets', async () => {
    memberGet.mockResolvedValue(member('pending', 'stray-photon'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'anonymous',
      status: 'pending',
      username: 'stray-photon',
      needsUsername: false,
    });
  });

  it('gives a blocked member exactly what a stranger gets', async () => {
    memberGet.mockResolvedValue(member('blocked', 'idle-kernel'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'anonymous',
      status: 'blocked',
      username: 'idle-kernel',
      needsUsername: false,
    });
  });

  it('flags a member who has not picked a handle', async () => {
    memberGet.mockResolvedValue(member('approved'));
    const result = await resolveMembership({ sub: 'github:9' });
    expect(result.needsUsername).toBe(true);
    expect(result.username).toBeUndefined();
  });

  // Owners are named by the site's own configuration, so they are never asked.
  it('never asks an owner for a handle', async () => {
    const result = await resolveMembership({ sub: 'github:1', login: 'the-owner' });
    expect(result.needsUsername).toBe(false);
  });

  it('reports someone with no row yet as pending', async () => {
    memberGet.mockResolvedValue(null);
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'anonymous',
      status: 'pending',
      needsUsername: false,
    });
  });

  // The important failure mode: a broken database must deny, not promote.
  it('degrades to anonymous when the lookup throws', async () => {
    memberGet.mockRejectedValue(new Error('D1 unavailable'));
    expect(await resolveMembership({ sub: 'github:9' })).toEqual({
      audience: 'anonymous',
      needsUsername: false,
    });
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
    memberGet.mockResolvedValue(member('pending', 'quiet-wafer'));
    await recordSignIn({ sub: 'github:9', login: 'rando' });
    expect(memberRecord).toHaveBeenCalledWith({ sub: 'github:9', login: 'rando' });
  });

  it('reports a first-time member as needing a handle', async () => {
    memberRecord.mockResolvedValue(undefined);
    memberGet.mockResolvedValue(member('pending'));
    expect(await recordSignIn({ sub: 'github:9' })).toEqual({ needsUsername: true });
  });

  it('does not re-prompt someone who already has one', async () => {
    memberRecord.mockResolvedValue(undefined);
    memberGet.mockResolvedValue(member('approved', 'stray-photon'));
    expect(await recordSignIn({ sub: 'github:9' })).toEqual({ needsUsername: false });
  });

  // Sign-in must succeed even if the queue write fails; the person simply
  // does not appear in the approval list until they come back.
  it('does not throw when the write fails', async () => {
    memberRecord.mockRejectedValue(new Error('D1 unavailable'));
    expect(await recordSignIn({ sub: 'github:9' })).toEqual({ needsUsername: false });
  });
});
