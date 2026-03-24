import type { IncomingMessage, ServerResponse } from 'http';
import {
  deleteChannelAccountConfig,
  deleteChannelConfig,
  cleanupDanglingWeChatPluginState,
  getChannelFormValues,
  listConfiguredChannelAccounts,
  listConfiguredChannels,
  readOpenClawConfig,
  saveChannelConfig,
  setChannelDefaultAccount,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../../utils/channel-config';
import {
  assignChannelAccountToAgent,
  clearAllBindingsForChannel,
  clearChannelBinding,
  listAgentsSnapshot,
} from '../../utils/agent-config';
import {
  ensureDingTalkPluginInstalled,
  ensureFeishuPluginInstalled,
  ensureQQBotPluginInstalled,
  ensureWeChatPluginInstalled,
  ensureWeComPluginInstalled,
} from '../../utils/plugin-install';
import {
  computeChannelRuntimeStatus,
  pickChannelRuntimeStatus,
  type ChannelRuntimeAccountSnapshot,
} from '../../utils/channel-status';
import {
  OPENCLAW_WECHAT_CHANNEL_TYPE,
  UI_WECHAT_CHANNEL_TYPE,
  buildQrChannelEventName,
  toOpenClawChannelType,
  toUiChannelType,
} from '../../utils/channel-alias';
import {
  cancelWeChatLoginSession,
  saveWeChatAccountState,
  startWeChatLoginSession,
  waitForWeChatLoginSession,
} from '../../utils/wechat-login';
import { whatsAppLoginManager } from '../../utils/whatsapp-login';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const WECHAT_QR_TIMEOUT_MS = 8 * 60 * 1000;
const activeQrLogins = new Map<string, string>();

interface WebLoginStartResult {
  qrcodeUrl?: string;
  message?: string;
  sessionKey?: string;
}

function resolveStoredChannelType(channelType: string): string {
  return toOpenClawChannelType(channelType);
}

function buildQrLoginKey(channelType: string, accountId?: string): string {
  return `${toUiChannelType(channelType)}:${accountId?.trim() || '__new__'}`;
}

function setActiveQrLogin(channelType: string, sessionKey: string, accountId?: string): string {
  const loginKey = buildQrLoginKey(channelType, accountId);
  activeQrLogins.set(loginKey, sessionKey);
  return loginKey;
}

function isActiveQrLogin(loginKey: string, sessionKey: string): boolean {
  return activeQrLogins.get(loginKey) === sessionKey;
}

function clearActiveQrLogin(channelType: string, accountId?: string): void {
  activeQrLogins.delete(buildQrLoginKey(channelType, accountId));
}

function emitChannelEvent(
  ctx: HostApiContext,
  channelType: string,
  event: 'qr' | 'success' | 'error',
  payload: unknown,
): void {
  const eventName = buildQrChannelEventName(channelType, event);
  ctx.eventBus.emit(eventName, payload);
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(eventName, payload);
  }
}

async function startWeChatQrLogin(ctx: HostApiContext, accountId?: string): Promise<WebLoginStartResult> {
  void ctx;
  return await startWeChatLoginSession({
    ...(accountId ? { accountId } : {}),
    force: true,
  });
}

async function awaitWeChatQrLogin(
  ctx: HostApiContext,
  sessionKey: string,
  loginKey: string,
): Promise<void> {
  try {
    const result = await waitForWeChatLoginSession({
      sessionKey,
      timeoutMs: WECHAT_QR_TIMEOUT_MS,
      onQrRefresh: async ({ qrcodeUrl }) => {
        if (!isActiveQrLogin(loginKey, sessionKey)) {
          return;
        }
        emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'qr', {
          qr: qrcodeUrl,
          raw: qrcodeUrl,
          sessionKey,
        });
      },
    });

    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }

    if (!result.connected || !result.accountId || !result.botToken) {
      emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'error', result.message || 'WeChat login did not complete');
      return;
    }

    const normalizedAccountId = await saveWeChatAccountState(result.accountId, {
      token: result.botToken,
      baseUrl: result.baseUrl,
      userId: result.userId,
    });
    await saveChannelConfig(UI_WECHAT_CHANNEL_TYPE, { enabled: true }, normalizedAccountId);
    await ensureScopedChannelBinding(UI_WECHAT_CHANNEL_TYPE, normalizedAccountId);
    scheduleGatewayChannelSaveRefresh(ctx, OPENCLAW_WECHAT_CHANNEL_TYPE, `wechat:loginSuccess:${normalizedAccountId}`);

    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }

    emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'success', {
      accountId: normalizedAccountId,
      rawAccountId: result.accountId,
      message: result.message,
    });
  } catch (error) {
    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }
    emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'error', String(error));
  } finally {
    if (isActiveQrLogin(loginKey, sessionKey)) {
      activeQrLogins.delete(loginKey);
    }
    await cancelWeChatLoginSession(sessionKey);
  }
}

function scheduleGatewayChannelRestart(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state === 'stopped') {
    return;
  }
  ctx.gatewayManager.debouncedRestart();
  void reason;
}

// Plugin-based channels require a full Gateway process restart to properly
// initialize / tear-down plugin connections.  SIGUSR1 in-process reload is
// not sufficient for channel plugins (see restartGatewayForAgentDeletion).
const FORCE_RESTART_CHANNELS = new Set(['dingtalk', 'wecom', 'whatsapp', 'feishu', 'qqbot', OPENCLAW_WECHAT_CHANNEL_TYPE]);

function scheduleGatewayChannelSaveRefresh(
  ctx: HostApiContext,
  channelType: string,
  reason: string,
): void {
  const storedChannelType = resolveStoredChannelType(channelType);
  if (ctx.gatewayManager.getStatus().state === 'stopped') {
    return;
  }
  if (FORCE_RESTART_CHANNELS.has(storedChannelType)) {
    ctx.gatewayManager.debouncedRestart();
    void reason;
    return;
  }
  ctx.gatewayManager.debouncedReload();
  void reason;
}

function toComparableConfig(input: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      next[key] = value.trim();
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = String(value);
    }
  }
  return next;
}

function isSameConfigValues(
  existing: Record<string, string> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  const next = toComparableConfig(incoming);
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  if (keys.size === 0) return false;
  for (const key of keys) {
    if ((existing[key] ?? '') !== (next[key] ?? '')) {
      return false;
    }
  }
  return true;
}

async function ensureScopedChannelBinding(channelType: string, accountId?: string): Promise<void> {
  const storedChannelType = resolveStoredChannelType(channelType);
  // Multi-agent safety: only bind when the caller explicitly scopes the account.
  // Global channel saves (no accountId) must not override routing to "main".
  if (!accountId) return;
  const agents = await listAgentsSnapshot();
  if (!agents.agents || agents.agents.length === 0) return;

  // Keep backward compatibility for the legacy default account.
  if (accountId === 'default') {
    if (agents.agents.some((entry) => entry.id === 'main')) {
      await assignChannelAccountToAgent('main', storedChannelType, 'default');
    }
    return;
  }

  // Legacy compatibility: if accountId matches an existing agentId, keep auto-binding.
  if (agents.agents.some((entry) => entry.id === accountId)) {
    await assignChannelAccountToAgent(accountId, storedChannelType, accountId);
  }
}

interface GatewayChannelStatusPayload {
  channelOrder?: string[];
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, Array<{
    accountId?: string;
    configured?: boolean;
    connected?: boolean;
    running?: boolean;
    lastError?: string;
    name?: string;
    linked?: boolean;
    lastConnectedAt?: number | null;
    lastInboundAt?: number | null;
    lastOutboundAt?: number | null;
    lastProbeAt?: number | null;
    probe?: {
      ok?: boolean;
    } | null;
  }>>;
  channelDefaultAccountId?: Record<string, string>;
}

interface ChannelAccountView {
  accountId: string;
  name: string;
  configured: boolean;
  connected: boolean;
  running: boolean;
  linked: boolean;
  lastError?: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  isDefault: boolean;
  agentId?: string;
}

interface ChannelAccountsView {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountView[];
}

async function buildChannelAccountsView(ctx: HostApiContext): Promise<ChannelAccountsView[]> {
  const [configuredChannels, configuredAccounts, openClawConfig, agentsSnapshot] = await Promise.all([
    listConfiguredChannels(),
    listConfiguredChannelAccounts(),
    readOpenClawConfig(),
    listAgentsSnapshot(),
  ]);

  let gatewayStatus: GatewayChannelStatusPayload | null;
  try {
    gatewayStatus = await ctx.gatewayManager.rpc<GatewayChannelStatusPayload>('channels.status', { probe: true });
  } catch {
    gatewayStatus = null;
  }

  const channelTypes = new Set<string>([
    ...configuredChannels,
    ...Object.keys(configuredAccounts),
    ...Object.keys(gatewayStatus?.channelAccounts || {}),
  ]);

  const channels: ChannelAccountsView[] = [];
  for (const rawChannelType of channelTypes) {
    const uiChannelType = toUiChannelType(rawChannelType);
    const channelAccountsFromConfig = configuredAccounts[rawChannelType]?.accountIds ?? [];
    const hasLocalConfig = configuredChannels.includes(rawChannelType) || Boolean(configuredAccounts[rawChannelType]);
    const channelSection = openClawConfig.channels?.[rawChannelType];
    const channelSummary =
      (gatewayStatus?.channels?.[rawChannelType] as { error?: string; lastError?: string } | undefined) ?? undefined;
    const sortedConfigAccountIds = [...channelAccountsFromConfig].sort((left, right) => {
      if (left === 'default') return -1;
      if (right === 'default') return 1;
      return left.localeCompare(right);
    });
    const fallbackDefault =
      typeof channelSection?.defaultAccount === 'string' && channelSection.defaultAccount.trim()
        ? channelSection.defaultAccount
        : (sortedConfigAccountIds[0] || 'default');
    const defaultAccountId = configuredAccounts[rawChannelType]?.defaultAccountId
      ?? gatewayStatus?.channelDefaultAccountId?.[rawChannelType]
      ?? fallbackDefault;
    const runtimeAccounts = gatewayStatus?.channelAccounts?.[rawChannelType] ?? [];
    const hasRuntimeConfigured = runtimeAccounts.some((account) => account.configured === true);
    if (!hasLocalConfig && !hasRuntimeConfigured) {
      continue;
    }
    const runtimeAccountIds = runtimeAccounts
      .map((account) => account.accountId)
      .filter((accountId): accountId is string => typeof accountId === 'string' && accountId.trim().length > 0);
    const accountIds = Array.from(new Set([...channelAccountsFromConfig, ...runtimeAccountIds, defaultAccountId]));

    const accounts: ChannelAccountView[] = accountIds.map((accountId) => {
      const runtime = runtimeAccounts.find((item) => item.accountId === accountId);
      const runtimeSnapshot: ChannelRuntimeAccountSnapshot = runtime ?? {};
      const status = computeChannelRuntimeStatus(runtimeSnapshot);
      return {
        accountId,
        name: runtime?.name || accountId,
        configured: channelAccountsFromConfig.includes(accountId) || runtime?.configured === true,
        connected: runtime?.connected === true,
        running: runtime?.running === true,
        linked: runtime?.linked === true,
        lastError: typeof runtime?.lastError === 'string' ? runtime.lastError : undefined,
        status,
        isDefault: accountId === defaultAccountId,
        agentId: agentsSnapshot.channelAccountOwners[`${rawChannelType}:${accountId}`],
      };
    }).sort((left, right) => {
      if (left.accountId === defaultAccountId) return -1;
      if (right.accountId === defaultAccountId) return 1;
      return left.accountId.localeCompare(right.accountId);
    });

    channels.push({
      channelType: uiChannelType,
      defaultAccountId,
      status: pickChannelRuntimeStatus(runtimeAccounts, channelSummary),
      accounts,
    });
  }

  return channels.sort((left, right) => left.channelType.localeCompare(right.channelType));
}

export async function handleChannelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/channels/configured' && req.method === 'GET') {
    const channels = await listConfiguredChannels();
    sendJson(res, 200, { success: true, channels: Array.from(new Set(channels.map((channel) => toUiChannelType(channel)))) });
    return true;
  }

  if (url.pathname === '/api/channels/accounts' && req.method === 'GET') {
    try {
      const channels = await buildChannelAccountsView(ctx);
      sendJson(res, 200, { success: true, channels });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/default-account' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; accountId: string }>(req);
      await setChannelDefaultAccount(body.channelType, body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, body.channelType, `channel:setDefaultAccount:${body.channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/binding' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; accountId: string; agentId: string }>(req);
      await assignChannelAccountToAgent(body.agentId, resolveStoredChannelType(body.channelType), body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, body.channelType, `channel:setBinding:${body.channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/binding' && req.method === 'DELETE') {
    try {
      const body = await parseJsonBody<{ channelType: string; accountId: string }>(req);
      await clearChannelBinding(resolveStoredChannelType(body.channelType), body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, body.channelType, `channel:clearBinding:${body.channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelConfig(body.channelType)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/credentials/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, string> }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelCredentials(body.channelType, body.config)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      await whatsAppLoginManager.start(body.accountId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/cancel' && req.method === 'POST') {
    try {
      await whatsAppLoginManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/wechat/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      const requestedAccountId = body.accountId?.trim() || undefined;

      const installResult = await ensureWeChatPluginInstalled();
      if (!installResult.installed) {
        sendJson(res, 500, { success: false, error: installResult.warning || 'WeChat plugin install failed' });
        return true;
      }

      await cleanupDanglingWeChatPluginState();
      const startResult = await startWeChatQrLogin(ctx, requestedAccountId);
      if (!startResult.qrcodeUrl || !startResult.sessionKey) {
        throw new Error(startResult.message || 'Failed to generate WeChat QR code');
      }

      const loginKey = setActiveQrLogin(UI_WECHAT_CHANNEL_TYPE, startResult.sessionKey, requestedAccountId);
      emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'qr', {
        qr: startResult.qrcodeUrl,
        raw: startResult.qrcodeUrl,
        sessionKey: startResult.sessionKey,
      });
      void awaitWeChatQrLogin(ctx, startResult.sessionKey, loginKey);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/wechat/cancel' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      const accountId = body.accountId?.trim() || undefined;
      const loginKey = buildQrLoginKey(UI_WECHAT_CHANNEL_TYPE, accountId);
      const sessionKey = activeQrLogins.get(loginKey);
      clearActiveQrLogin(UI_WECHAT_CHANNEL_TYPE, accountId);
      if (sessionKey) {
        await cancelWeChatLoginSession(sessionKey);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, unknown>; accountId?: string }>(req);
      const storedChannelType = resolveStoredChannelType(body.channelType);
      if (storedChannelType === 'dingtalk') {
        const installResult = await ensureDingTalkPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'DingTalk plugin install failed' });
          return true;
        }
      }
      if (storedChannelType === 'wecom') {
        const installResult = await ensureWeComPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'WeCom plugin install failed' });
          return true;
        }
      }
      if (storedChannelType === 'qqbot') {
        const installResult = await ensureQQBotPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'QQ Bot plugin install failed' });
          return true;
        }
      }
      if (storedChannelType === 'feishu') {
        const installResult = await ensureFeishuPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'Feishu plugin install failed' });
          return true;
        }
      }
      if (storedChannelType === OPENCLAW_WECHAT_CHANNEL_TYPE) {
        const installResult = await ensureWeChatPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'WeChat plugin install failed' });
          return true;
        }
      }
      const existingValues = await getChannelFormValues(body.channelType, body.accountId);
      if (isSameConfigValues(existingValues, body.config)) {
        await ensureScopedChannelBinding(body.channelType, body.accountId);
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await saveChannelConfig(body.channelType, body.config, body.accountId);
      await ensureScopedChannelBinding(body.channelType, body.accountId);
      scheduleGatewayChannelSaveRefresh(ctx, storedChannelType, `channel:saveConfig:${storedChannelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/enabled' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; enabled: boolean }>(req);
      await setChannelEnabled(body.channelType, body.enabled);
      scheduleGatewayChannelRestart(ctx, `channel:setEnabled:${resolveStoredChannelType(body.channelType)}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'GET') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      const accountId = url.searchParams.get('accountId') || undefined;
      sendJson(res, 200, {
        success: true,
        values: await getChannelFormValues(channelType, accountId),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'DELETE') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      const accountId = url.searchParams.get('accountId') || undefined;
      const storedChannelType = resolveStoredChannelType(channelType);
      if (accountId) {
        await deleteChannelAccountConfig(channelType, accountId);
        await clearChannelBinding(storedChannelType, accountId);
        scheduleGatewayChannelSaveRefresh(ctx, storedChannelType, `channel:deleteAccount:${storedChannelType}`);
      } else {
        await deleteChannelConfig(channelType);
        await clearAllBindingsForChannel(storedChannelType);
        scheduleGatewayChannelRestart(ctx, `channel:deleteConfig:${storedChannelType}`);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  void ctx;
  return false;
}
