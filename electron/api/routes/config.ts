import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { getRecentTokenUsageHistory } from '../../utils/token-usage';
import { getProviderService } from '../../services/providers/provider-service';

export async function handleConfigRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/config' && req.method === 'GET') {
    const providerService = getProviderService();
    try {
      const snapshot = await listAgentsSnapshot();
      const agents = snapshot.agents || [];
      const tokenHistory = await getRecentTokenUsageHistory(1000);
      const agentStats = new Map<string, {
        totalTokens: number;
        weeklyTokens: number[];
        messageCount: number;
        sessions: Set<string>;
        lastActive: number;
      }>();
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;

      for (const entry of tokenHistory) {
        const agentId = entry.agentId;
        if (!agentStats.has(agentId)) {
          agentStats.set(agentId, {
            totalTokens: 0,
            weeklyTokens: [0, 0, 0, 0, 0, 0, 0],
            messageCount: 0,
            sessions: new Set<string>(),
            lastActive: 0,
          });
        }
        const stats = agentStats.get(agentId)!;
        stats.totalTokens += entry.totalTokens;
        stats.messageCount += 1;
        if (entry.sessionId) stats.sessions.add(entry.sessionId);

        const entryTime = Date.parse(entry.timestamp);
        if (!isNaN(entryTime)) {
          if (entryTime > stats.lastActive) stats.lastActive = entryTime;
          if (now - entryTime < weekMs) {
            const dayIndex = Math.floor((now - entryTime) / (24 * 60 * 60 * 1000));
            if (dayIndex >= 0 && dayIndex < 7) {
              stats.weeklyTokens[6 - dayIndex] += entry.totalTokens;
            }
          }
        }
      }

      const agentsWithStats = agents.map((agent) => {
        const stats = agentStats.get(agent.id);
        return {
          ...agent,
          model: agent.modelDisplay,
          platforms: (agent.channelTypes || []).map((name: string) => ({ name })),
          session: stats ? {
            totalTokens: stats.totalTokens,
            weeklyTokens: stats.weeklyTokens,
            messageCount: stats.messageCount,
            sessionCount: stats.sessions.size,
            lastActive: stats.lastActive,
          } : undefined,
        };
      });

      console.log('[config] Starting provider fetch...');
      try {
        const accounts = await providerService.listAccounts();
        const vendors = await providerService.listVendors();

        console.log('[config] accounts:', accounts.length);
        console.log('[config] vendors:', vendors.length);

        const providers = accounts.map(account => {
          const vendor = vendors.find(v => v.id === account.vendorId);
          const usedBy = agents.filter(a => a.providerId === account.id).map(a => ({
            id: a.id,
            emoji: a.emoji || '🤖',
            name: a.name
          }));

          const models = (vendor?.providerConfig?.models || []).map(m => ({
            id: m.id,
            name: m.name || m.id,
            contextWindow: m.contextWindow
          }));

          if (models.length === 0 && account.model) {
            models.push({
              id: account.model,
              name: account.model,
              contextWindow: undefined
            });
          }

          return {
            id: account.id,
            label: account.label,
            api: vendor?.apiKeyUrl || '',
            models,
            usedBy
          };
        });

        console.log('[config] providers:', providers.length);

        sendJson(res, 200, {
          agents: agentsWithStats,
          gateway: {
            port: ctx.gatewayManager.getStatus().port || 18789,
          },
          providers,
        });
      } catch (err) {
        console.error('[config] Provider fetch error:', err);
        sendJson(res, 200, {
          agents: agentsWithStats,
          gateway: {
            port: ctx.gatewayManager.getStatus().port || 18789,
          },
          providers: [],
        });
      }
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  return false;
}
