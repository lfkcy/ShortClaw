import { EventEmitter } from 'events';
import { BrowserWindow, shell } from 'electron';
import { logger } from './logger';
import { loginGeminiCliOAuth, type GeminiCliOAuthCredentials } from './gemini-cli-oauth';
import { loginOpenAICodexOAuth, type OpenAICodexOAuthCredentials } from './openai-codex-oauth';
import { loginShortApiOAuth, type ShortApiOAuthCredentials } from './shortapi-oauth';
import { getProviderService } from '../services/providers/provider-service';
import { getSecretStore } from '../services/secrets/secret-store';
import { saveOAuthTokenToOpenClaw } from './openclaw-auth';

export type BrowserOAuthProviderType = 'google' | 'openai' | 'shortapi';

const GOOGLE_RUNTIME_PROVIDER_ID = 'google-gemini-cli';
const GOOGLE_OAUTH_DEFAULT_MODEL = 'gemini-3-pro-preview';
const OPENAI_RUNTIME_PROVIDER_ID = 'openai-codex';
const OPENAI_OAUTH_DEFAULT_MODEL = 'gpt-5.3-codex';
const SHORTAPI_RUNTIME_PROVIDER_ID = 'shortapi';

class BrowserOAuthManager extends EventEmitter {
  private activeProvider: BrowserOAuthProviderType | null = null;
  private activeAccountId: string | null = null;
  private activeLabel: string | null = null;
  private active = false;
  private mainWindow: BrowserWindow | null = null;
  private pendingManualCodeResolve: ((value: string) => void) | null = null;
  private pendingManualCodeReject: ((reason?: unknown) => void) | null = null;

  setWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  async startFlow(
    provider: BrowserOAuthProviderType,
    options?: { accountId?: string; label?: string },
  ): Promise<boolean> {
    if (this.active) {
      await this.stopFlow();
    }

    this.active = true;
    this.activeProvider = provider;
    this.activeAccountId = options?.accountId || provider;
    this.activeLabel = options?.label || null;
    this.emit('oauth:start', { provider, accountId: this.activeAccountId });

    if (provider === 'openai' || provider === 'shortapi') {
      // Flow may switch to manual callback mode; keep start API non-blocking.
      void this.executeFlow(provider);
      return true;
    }

    await this.executeFlow(provider);
    return true;
  }

  private async executeFlow(provider: BrowserOAuthProviderType): Promise<void> {
    try {
      const token = provider === 'google'
        ? await loginGeminiCliOAuth({
          isRemote: false,
          openUrl: async (url) => {
            await shell.openExternal(url);
          },
          log: (message) => logger.info(`[BrowserOAuth] ${message}`),
          note: async (message, title) => {
            logger.info(`[BrowserOAuth] ${title || 'OAuth note'}: ${message}`);
          },
          prompt: async () => {
            throw new Error('Manual browser OAuth fallback is not implemented in ShortClaw yet.');
          },
          progress: {
            update: (message) => logger.info(`[BrowserOAuth] ${message}`),
            stop: (message) => {
              if (message) {
                logger.info(`[BrowserOAuth] ${message}`);
              }
            },
          },
        })
        : provider === 'openai' 
          ? await loginOpenAICodexOAuth({
            openUrl: async (url) => {
              await shell.openExternal(url);
            },
            onProgress: (message) => logger.info(`[BrowserOAuth] ${message}`),
            onManualCodeRequired: ({ authorizationUrl, reason }) => {
              const message = reason === 'port_in_use'
                ? 'OpenAI OAuth callback port 1455 is in use. Complete sign-in, then paste the final callback URL or code.'
                : 'OpenAI OAuth callback timed out. Paste the final callback URL or code to continue.';
              const payload = {
                provider,
                mode: 'manual' as const,
                authorizationUrl,
                message,
              };
              this.emit('oauth:code', payload);
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('oauth:code', payload);
              }
            },
            onManualCodeInput: async () => {
              return await new Promise<string>((resolve, reject) => {
                this.pendingManualCodeResolve = resolve;
                this.pendingManualCodeReject = reject;
              });
            },
          })
          : await loginShortApiOAuth({
            openUrl: async (url) => {
              await shell.openExternal(url);
            },
            onProgress: (message) => logger.info(`[BrowserOAuth] ${message}`),
            onManualCodeRequired: ({ authorizationUrl, reason }) => {
              const message = reason === 'port_in_use'
                ? 'ShortAPI OAuth callback port 28775 is in use. Complete sign-in, then paste the URL or code.'
                : 'ShortAPI OAuth callback timed out. Paste the final URL or code to continue.';
              const payload = {
                provider,
                mode: 'manual' as const,
                authorizationUrl,
                message,
              };
              this.emit('oauth:code', payload);
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('oauth:code', payload);
              }
            },
            onManualCodeInput: async () => {
              return await new Promise<string>((resolve, reject) => {
                this.pendingManualCodeResolve = resolve;
                this.pendingManualCodeReject = reject;
              });
            },
          });

      await this.onSuccess(provider, token);
    } catch (error) {
      if (!this.active) {
        return;
      }
      logger.error(`[BrowserOAuth] Flow error for ${provider}:`, error);
      this.emitError(error instanceof Error ? error.message : String(error));
      this.active = false;
      this.activeProvider = null;
      this.activeAccountId = null;
      this.activeLabel = null;
      this.pendingManualCodeResolve = null;
      this.pendingManualCodeReject = null;
    }
  }

  async stopFlow(): Promise<void> {
    this.active = false;
    this.activeProvider = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    if (this.pendingManualCodeReject) {
      this.pendingManualCodeReject(new Error('OAuth flow cancelled'));
    }
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    logger.info('[BrowserOAuth] Flow explicitly stopped');
  }

  submitManualCode(code: string): boolean {
    const value = code.trim();
    if (!value || !this.pendingManualCodeResolve) {
      return false;
    }
    this.pendingManualCodeResolve(value);
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    return true;
  }

  private async onSuccess(
    providerType: BrowserOAuthProviderType,
    token: GeminiCliOAuthCredentials | OpenAICodexOAuthCredentials | ShortApiOAuthCredentials,
  ) {
    const accountId = this.activeAccountId || providerType;
    const accountLabel = this.activeLabel;
    this.active = false;
    this.activeProvider = null;
    this.activeAccountId = null;
    this.activeLabel = null;
    this.pendingManualCodeResolve = null;
    this.pendingManualCodeReject = null;
    logger.info(`[BrowserOAuth] Successfully completed OAuth for ${providerType}`);

    const providerService = getProviderService();
    const existing = await providerService.getAccount(accountId);
    const isGoogle = providerType === 'google';
    const isShortApi = providerType === 'shortapi';
    const runtimeProviderId = isGoogle ? GOOGLE_RUNTIME_PROVIDER_ID : isShortApi ? SHORTAPI_RUNTIME_PROVIDER_ID : OPENAI_RUNTIME_PROVIDER_ID;
    const defaultModel = isGoogle ? GOOGLE_OAUTH_DEFAULT_MODEL : isShortApi ? 'deepseek/deepseek-v3.2' : OPENAI_OAUTH_DEFAULT_MODEL;
    const accountLabelDefault = isGoogle ? 'Google Gemini' : isShortApi ? 'ShortAPI' : 'OpenAI Codex';
    const oauthTokenEmail = 'email' in token && typeof token.email === 'string' ? token.email : undefined;
    const oauthTokenSubject = 'projectId' in token && typeof token.projectId === 'string'
      ? token.projectId
      : ('accountId' in token && typeof token.accountId === 'string' ? token.accountId : undefined);

    const normalizedExistingModel = (() => {
      const value = existing?.model?.trim();
      if (!value) return undefined;
      if (isGoogle) {
        return value.includes('/') ? value.split('/').pop() : value;
      }
      // OpenAI OAuth uses openai-codex/* runtime; existing openai/* refs are incompatible.
      if (value.startsWith('openai/')) return undefined;
      if (value.startsWith('openai-codex/')) return value.split('/').pop();
      return value.includes('/') ? value.split('/').pop() : value;
    })();

    const nextAccount = await providerService.createAccount({
      id: accountId,
      vendorId: providerType,
      label: existing?.label || accountLabelDefault,
      authMode: 'oauth_browser',
      baseUrl: existing?.baseUrl,
      apiProtocol: existing?.apiProtocol,
      model: normalizedExistingModel || defaultModel,
      fallbackModels: existing?.fallbackModels,
      fallbackAccountIds: existing?.fallbackAccountIds,
      enabled: existing?.enabled ?? true,
      isDefault: existing?.isDefault ?? false,
      metadata: {
        ...existing?.metadata,
        email: oauthTokenEmail,
        resourceUrl: runtimeProviderId,
      },
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await getSecretStore().set({
      type: 'oauth',
      accountId,
      accessToken: token.access,
      refreshToken: token.refresh,
      expiresAt: token.expires,
      email: oauthTokenEmail,
      subject: oauthTokenSubject,
    });

    await saveOAuthTokenToOpenClaw(runtimeProviderId, {
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      email: oauthTokenEmail,
      projectId: oauthTokenSubject,
    });

    try {
      const { syncSavedProviderToRuntime } = await import('../services/providers/provider-runtime-sync');
      const { providerAccountToConfig } = await import('../services/providers/provider-store');
      await syncSavedProviderToRuntime(
        providerAccountToConfig(nextAccount),
        token.access,
        this.mainWindow ? (this as any).gatewayManager : undefined // Hack: assuming gatewayManager might be available if I add it, but for now let's just use undefined or check context
      );
    } catch (err) {
      logger.warn(`[BrowserOAuth] Failed to sync ${providerType} to runtime:`, err);
    }

    this.emit('oauth:success', { provider: providerType, accountId: nextAccount.id });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:success', {
        provider: providerType,
        accountId: nextAccount.id,
        success: true,
      });
    }
  }

  private emitError(message: string) {
    this.emit('oauth:error', { message });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:error', { message });
    }
  }
}

export const browserOAuthManager = new BrowserOAuthManager();
