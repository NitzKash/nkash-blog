import type { Provider } from './oauth';
import type { Viewer } from '../visibility';

/**
 * GitHub OAuth, web application flow.
 *
 * Only the `user:email` scope is requested — enough to read the account's
 * verified email addresses, and nothing else. No repository access.
 */

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
const USER_AGENT = 'nkash.dev';

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export const github: Provider = {
  id: 'github',
  label: 'GitHub',

  authorizeUrl(clientId, redirectUri, state) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'user:email');
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'false');
    return url.toString();
  },

  async exchange(code, clientId, clientSecret, redirectUri): Promise<Viewer> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`GitHub token exchange failed with status ${tokenResponse.status}`);
    }

    const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (tokenBody.error || !tokenBody.access_token) {
      throw new Error(`GitHub token exchange failed: ${tokenBody.error ?? 'no access_token'}`);
    }

    const headers = {
      Authorization: `Bearer ${tokenBody.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
    };

    const [userResponse, emailResponse] = await Promise.all([
      fetch(`${API}/user`, { headers }),
      fetch(`${API}/user/emails`, { headers }),
    ]);

    if (!userResponse.ok) throw new Error(`GitHub /user failed with status ${userResponse.status}`);
    const user = (await userResponse.json()) as GitHubUser;

    // Only ever trust a verified address. An unverified one can be set to
    // anything, which would make the email side of the access list forgeable.
    let email: string | undefined;
    if (emailResponse.ok) {
      const emails = (await emailResponse.json()) as GitHubEmail[];
      email =
        emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email;
    }

    return {
      sub: `github:${user.id}`,
      login: user.login,
      email,
      name: user.name ?? user.login,
      avatar: user.avatar_url ?? undefined,
    };
  },
};
