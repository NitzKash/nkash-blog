import type { Provider, ProviderId } from './oauth';
import { PROVIDERS, credentialKeys } from './oauth';
import { github } from './github';
import { google } from './google';
import { readEnv } from '../env';

export const providers: Record<ProviderId, Provider> = { github, google };

export function getProvider(id: string): Provider | null {
  return (PROVIDERS as readonly string[]).includes(id) ? providers[id as ProviderId] : null;
}

/**
 * Which providers are usable on this deployment.
 *
 * Configuring a provider is what enables it — there is no separate toggle to
 * forget. Deploying with only GitHub credentials set simply means the Google
 * button does not appear, rather than appearing and then failing.
 */
export function configuredProviders(): Provider[] {
  return PROVIDERS.map((id) => providers[id]).filter((provider) => {
    const keys = credentialKeys(provider.id);
    return Boolean(readEnv(keys.id) && readEnv(keys.secret));
  });
}
