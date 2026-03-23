import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { proxyAwareFetch } from './proxy-fetch';

const CLIENT_ID = 'shortclaw_desktop';
// ShortClaw is expected to listen to this local port
const REDIRECT_URI = 'http://127.0.0.1:28775/auth/callback';

export interface ShortApiOAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

interface ShortApiOAuthAuthorizationFlow {
  verifier: string;
  state: string;
  url: string;
}

interface ShortApiLocalServer {
  close: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
}

function getBaseUrl(): string {
  // Uses environment variable or default
  return process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : 'https://shortapi.ai';
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState(): string {
  return toBase64Url(randomBytes(32));
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // not a URL
  }

  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  return { code: value };
}

async function createAuthorizationFlow(): Promise<ShortApiOAuthAuthorizationFlow> {
  const { verifier, challenge } = createPkce();
  const state = createState();
  const baseUrl = getBaseUrl();
  const url = new URL('/oauth/authorize', baseUrl);
  
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  return { verifier, state, url: url.toString() };
}

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authentication successful</title>
</head>
<body>
  <p>Authentication successful. Return to ShortClaw to continue.</p>
</body>
</html>`;

function startLocalOAuthServer(state: string): Promise<ShortApiLocalServer | null> {
  let lastCode: string | null = null;

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '', 'http://127.0.0.1');
      if (url.pathname !== '/auth/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400;
        res.end('State mismatch');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.end('Missing authorization code');
        return;
      }

      lastCode = code;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(SUCCESS_HTML);
    } catch {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  return new Promise((resolve) => {
    server
      .listen(28775, '127.0.0.1', () => {
        resolve({
          close: () => server.close(),
          waitForCode: async () => {
            const sleep = () => new Promise((r) => setTimeout(r, 100));
            // Wait up to 60 seconds (600 * 100ms)
            for (let i = 0; i < 600; i += 1) {
              if (lastCode) {
                return { code: lastCode };
              }
              await sleep();
            }
            return null;
          },
        });
      })
      .on('error', () => {
        resolve(null);
      });
  });
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
): Promise<{ access: string; refresh: string; expires: number; accountId: string }> {
  const baseUrl = getBaseUrl();
  const tokenUrl = new URL('/api/oauth/token', baseUrl).toString();

  const response = await proxyAwareFetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ShortAPI token exchange failed (${response.status}): ${text}`);
  }

  const json = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    account_id?: string;
  };

  if (!json.access_token) {
    throw new Error('ShortAPI token response missing access_token');
  }

  return {
    access: json.access_token,
    refresh: json.refresh_token || '',
    expires: json.expires_in ? Date.now() + json.expires_in * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000,
    accountId: json.account_id || 'default-account',
  };
}

export async function refreshShortApiToken(refreshToken: string): Promise<{ access: string; refresh: string; expires: number }> {
  const baseUrl = getBaseUrl();
  const tokenUrl = new URL('/api/oauth/token', baseUrl).toString();

  const response = await proxyAwareFetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ShortAPI token refresh failed (${response.status}): ${text}`);
  }

  const json = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!json.access_token) {
    throw new Error('ShortAPI token refresh response missing access_token');
  }

  return {
    access: json.access_token,
    refresh: json.refresh_token || refreshToken,
    expires: json.expires_in ? Date.now() + json.expires_in * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
}

export async function loginShortApiOAuth(options: {
  openUrl: (url: string) => Promise<void>;
  onProgress?: (message: string) => void;
  onManualCodeRequired?: (payload: { authorizationUrl: string; reason: 'port_in_use' | 'callback_timeout' }) => void;
  onManualCodeInput?: () => Promise<string>;
}): Promise<ShortApiOAuthCredentials> {
  const { verifier, state, url } = await createAuthorizationFlow();
  options.onProgress?.('Opening ShortAPI sign-in page…');

  const server = await startLocalOAuthServer(state);

  try {
    await options.openUrl(url);
    options.onProgress?.(
      server ? 'Waiting for ShortAPI OAuth callback…' : 'Callback port unavailable, waiting for manual authorization code…',
    );

    let code: string | undefined;
    if (server) {
      const result = await server.waitForCode();
      code = result?.code ?? undefined;
      if (!code && options.onManualCodeInput) {
        options.onManualCodeRequired?.({ authorizationUrl: url, reason: 'callback_timeout' });
        code = await options.onManualCodeInput();
      }
    } else {
      if (!options.onManualCodeInput) {
        throw new Error('Cannot start ShortAPI OAuth callback server on 127.0.0.1:28775');
      }
      options.onManualCodeRequired?.({ authorizationUrl: url, reason: 'port_in_use' });
      code = await options.onManualCodeInput();
    }

    if (!code) {
      throw new Error('Missing ShortAPI authorization code');
    }

    const parsed = parseAuthorizationInput(code);
    if (parsed.state && parsed.state !== state) {
      throw new Error('ShortAPI OAuth state mismatch');
    }
    code = parsed.code;

    if (!code) {
      throw new Error('Missing ShortAPI authorization code');
    }

    const token = await exchangeAuthorizationCode(code, verifier);

    return {
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      accountId: token.accountId,
    };
  } finally {
    server?.close();
  }
}
