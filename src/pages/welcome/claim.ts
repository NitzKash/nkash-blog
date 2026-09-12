import type { APIRoute } from 'astro';
import * as members from '../../lib/data/members';
import { validate, normalise, MESSAGES } from '../../lib/username';
import { safeRedirect } from '../../lib/redirect';

export const prerender = false;

const seeOther = (location: string): Response =>
  new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'private, no-store' },
  });

const backToWelcome = (params: Record<string, string>): Response => {
  const query = new URLSearchParams(params);
  return seeOther(`/welcome?${query}`);
};

export const POST: APIRoute = async ({ request, locals, url }) => {
  const { viewer } = locals;
  if (!viewer) return new Response(null, { status: 401 });

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const form = await request.formData();
  const next = safeRedirect(String(form.get('next') ?? ''));
  const raw = String(form.get('username') ?? '');

  const problem = validate(raw);
  if (problem) return backToWelcome({ next, error: MESSAGES[problem] });

  const username = normalise(raw);

  let claimed: boolean;
  try {
    claimed = await members.claimUsername(viewer.sub, username);
  } catch (error) {
    console.error('could not claim username', error);
    return backToWelcome({ next, error: 'Something went wrong. Try again.' });
  }

  // Taken is the expected outcome of a race, not an error worth a stack trace:
  // two people can reasonably land on the same generated suggestion.
  if (!claimed) return backToWelcome({ next, taken: username });

  return seeOther(next);
};
