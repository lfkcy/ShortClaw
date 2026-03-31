import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getRecentTokenUsageHistory } from '../../utils/token-usage';
import { listConfiguredAgentIds } from '../../utils/agent-config';

export async function handlePixelOfficeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/activity-heatmap' && req.method === 'GET') {
    try {
      const tokenHistory = await getRecentTokenUsageHistory(5000);
      const agentHeatmaps = new Map<string, number[][]>();
      const now = Date.now();
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

      for (const entry of tokenHistory) {
        const timestamp = Date.parse(entry.timestamp);
        if (isNaN(timestamp) || timestamp < thirtyDaysAgo) continue;

        const date = new Date(timestamp);
        const dayOfWeek = (date.getDay() + 6) % 7;
        const hour = date.getHours();

        if (!agentHeatmaps.has(entry.agentId)) {
          agentHeatmaps.set(entry.agentId, Array.from({ length: 7 }, () => Array(24).fill(0)));
        }

        const grid = agentHeatmaps.get(entry.agentId)!;
        grid[dayOfWeek][hour]++;
      }

      const agents = Array.from(agentHeatmaps.entries()).map(([agentId, grid]) => ({
        agentId,
        grid,
      }));

      sendJson(res, 200, { agents });
    } catch {
      sendJson(res, 200, { agents: [] });
    }
    return true;
  }

  if (url.pathname === '/api/pixel-office/idle-rank' && req.method === 'GET') {
    try {
      const tokenHistory = await getRecentTokenUsageHistory(2000);
      const allAgentIds = await listConfiguredAgentIds();
      const now = Date.now();
      const windowMs = 24 * 60 * 60 * 1000;
      const agentMinutes = new Map<string, Set<number>>();

      // Initialize all agents with empty sets
      for (const id of allAgentIds) {
        agentMinutes.set(id, new Set<number>());
      }

      for (const entry of tokenHistory) {
        const timestamp = Date.parse(entry.timestamp);
        if (isNaN(timestamp) || now - timestamp > windowMs) continue;

        if (!agentMinutes.has(entry.agentId)) {
          // In case there's history for an agent not in the current config
          agentMinutes.set(entry.agentId, new Set<number>());
        }
        const minute = Math.floor(timestamp / 60000);
        agentMinutes.get(entry.agentId)!.add(minute);
      }

      const totalWindowMinutes = 24 * 60;
      const agents = Array.from(agentMinutes.entries())
        .map(([agentId, activeMins]) => {
          const activeMinutes = activeMins.size;
          const onlineMinutes = totalWindowMinutes;
          const idleMinutes = Math.max(0, onlineMinutes - activeMinutes);
          const idlePercent = Math.round((idleMinutes / onlineMinutes) * 100);

          return {
            agentId,
            onlineMinutes,
            activeMinutes,
            idleMinutes,
            idlePercent,
          };
        })
        .sort((a, b) => b.idlePercent - a.idlePercent);

      sendJson(res, 200, { agents });
    } catch {
      sendJson(res, 500, { error: 'Failed to calculate idle rank' });
    }
    return true;
  }

  if (url.pathname === '/api/pixel-office/version' && req.method === 'GET') {
    try {
      const force = url.searchParams.get('force') === '1';
      const versionInfo = await getLatestVersionInfo(force);
      sendJson(res, 200, versionInfo);
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  return false;
}

type ReleaseInfo = {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  htmlUrl: string;
};

let versionCache: { data: ReleaseInfo; ts: number } | null = null;
const VERSION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  html_url: string;
}

async function getLatestVersionInfo(force = false) {
  if (!force && versionCache && Date.now() - versionCache.ts < VERSION_CACHE_TTL) {
    return versionCache.data;
  }

  const repo = 'OpenClaw/OpenClaw';
  const url = `https://api.github.com/repos/${repo}/releases/latest`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ShortClaw-App'
      }
    });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json() as GitHubRelease;

    const info = {
      tag: data.tag_name,
      name: data.name,
      publishedAt: data.published_at,
      body: data.body,
      htmlUrl: data.html_url
    };

    versionCache = { data: info, ts: Date.now() };
    return info;
  } catch (error) {
    console.error('Failed to fetch version info:', error);
    // Return a fallback or throw
    if (versionCache) return versionCache.data;
    throw error;
  }
}
