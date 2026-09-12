import type { Provider } from './oauth';
import type { Viewer } from '../visibility';

/**
 * Google OAuth 2.0 / OpenID Connect.
 *
 * Requests `openid email profile` and nothing else — no Drive, no Gmail, no
 * contacts. The point is to learn a verified email address so the access list
 * can be checked against it.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export const google: Provider = {
  id: 'google',
  label: 'Google',

  authorizeUrl(clientId, redirectUri, state) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);

    // `prompt` is deliberately not set. Google then reuses an existing browser
    // session: a reader already signed into Gmail who has consented once is
    // redirected straight back with no interaction at all. Setting
    // `select_account` would force the account picker on every visit, and
    // `consent` would re-ask every time — both are friction for a reader whose
    // only goal is to open one post. Google still shows the picker on its own
    // when more than one account is signed in, which is the case where a
    // choice genuinely has to be made.
    return url.toString();
  },

  async exchange(code, clientId, clientSecret, redirectUri): Promise<Viewer> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed with status ${tokenResponse.status}`);
    }

    const { access_token } = (await tokenResponse.json()) as { access_token?: string };
    if (!access_token) throw new Error('Google token exchange returned no access_token');

    const userResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userResponse.ok) {
      throw new Error(`Google userinfo failed with status ${userResponse.status}`);
    }

    const user = (await userResponse.json()) as GoogleUserInfo;

    // An unverified address proves nothing about who is holding the account,
    // and the access list matches on email — so refuse it rather than let it
    // through as an identity.
    const email = user.email_verified === true ? user.email : undefined;

    return {
      sub: `google:${user.sub}`,
      email,
      name: user.name ?? email,
      avatar: user.picture,
    };
  },
};
