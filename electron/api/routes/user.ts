/**
 * User Routes
 * Handle user profile fetching (via ShortAPI) and logout for ShortAPI OAuth users.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getProviderService } from '../../services/providers/provider-service';
import { getSecretStore } from '../../services/secrets/secret-store';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import { syncDeletedProviderApiKeyToRuntime } from '../../services/providers/provider-runtime-sync';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { logger } from '../../utils/logger';

// 本地测试也直接用线上的接口，因为如果要改地址的话，接口的baseUrl也需要改，openclaw.json也需要改，涉及面比较广
function getShortApiBaseUrl(): string {
  return 'https://api.shortapi.ai/api';
}

/**
 * Find a ShortAPI OAuth account from the provider list.
 */
async function findShortApiOAuthAccount() {
  const providerService = getProviderService();
  const accounts = await providerService.listAccounts();
  return accounts.find((a) => a.vendorId === 'shortapi' && a.authMode === 'oauth_browser') ?? null;
}

/**
 * Get access token for the given account. If expired, clear it and return null.
 */
async function getValidAccessToken(accountId: string): Promise<string | null> {
  const secretStore = getSecretStore();
  const secret = await secretStore.get(accountId);

  if (!secret || secret.type !== 'oauth') {
    return null;
  }

  // Token expired → clear it
  if (secret.expiresAt <= Date.now()) {
    logger.info('[User] ShortAPI OAuth token expired, clearing');
    await secretStore.delete(accountId);
    return null;
  }

  return secret.accessToken;
}

export async function handleUserRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext
): Promise<boolean> {
  // GET /api/user/profile
  if (url.pathname === '/api/user/profile' && req.method === 'GET') {
    try {
      const account = await findShortApiOAuthAccount();
      if (!account) {
        sendJson(res, 200, { authenticated: false, profile: null });
        return true;
      }

      const accessToken = await getValidAccessToken(account.id);
      if (!accessToken) {
        sendJson(res, 200, { authenticated: false, profile: null });
        return true;
      }

      const baseUrl = getShortApiBaseUrl();
      const profileUrl = `${baseUrl}/v1/user/profile`;
      const response = await proxyAwareFetch(profileUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(`[User] Profile fetch failed: ${response.status}`);
        sendJson(res, 200, { authenticated: false, profile: null });
        return true;
      }

      const data = (await response.json()) as {
        code: number;
        data: {
          name: string;
          email: string;
          avatar: string;
        };
      };

      if (data.code === 0) {
        sendJson(res, 200, {
          authenticated: true,
          profile: {
            name: data.data.name || '',
            avatar: data.data.avatar || '',
            email: data.data.email || '',
          },
        });
      } else {
        sendJson(res, 200, { authenticated: false, profile: null });
      }
    } catch (error) {
      logger.error('[User] Profile route error:', error);
      sendJson(res, 200, { authenticated: false, profile: null });
    }
    return true;
  }

  // POST /api/user/logout
  if (url.pathname === '/api/user/logout' && req.method === 'POST') {
    try {
      const account = await findShortApiOAuthAccount();
      if (!account) {
        sendJson(res, 200, { success: true });
        return true;
      }

      // Clear the OAuth secret first
      await getSecretStore().delete(account.id);

      // Check if there's still an API key after OAuth deletion
      const remainingSecret = await getSecretStore().get(account.id);
      const hasApiKey = remainingSecret?.type === 'api_key';

      if (hasApiKey) {
        // Keep account but switch to API key mode
        await getProviderService().updateAccount(account.id, { authMode: 'api_key' });
        logger.info('[User] ShortAPI OAuth logout: switched to API key mode');
      } else {
        // No API key, remove the account completely
        await getProviderService().deleteAccount(account.id);
        logger.info('[User] ShortAPI OAuth logout: removed account');

        // Sync runtime - remove the OAuth provider
        const config = providerAccountToConfig(account);
        await syncDeletedProviderApiKeyToRuntime(config, account.id, 'shortapi');
      }

      sendJson(res, 200, { success: true });
    } catch (error) {
      logger.error('[User] Logout error:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
