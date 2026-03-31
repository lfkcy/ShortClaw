import { app } from 'electron';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import type { HostApiContext } from './context';

const OFFICE_DIR = join(app.getPath('userData'), 'pixel-office');
const LAYOUT_FILE = join(OFFICE_DIR, 'layout.json');

let contributionsCache: { data: any; ts: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getGitHubUsername(): string | null {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const sshMatch = url.match(/github\.com[:/]([^/]+)\//);
    if (sshMatch) return sshMatch[1];
    const httpsMatch = url.match(/github\.com\/([^/]+)\//);
    if (httpsMatch) return httpsMatch[1];
  } catch {}
  return null;
}

const LEVEL_TO_COUNT = [0, 2, 5, 8, 12];

async function fetchContributions(username: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://github.com/users/${username}/contributions`, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const cellRe = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"/g;
    const days: { date: string; count: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(html)) !== null) {
      const level = Math.min(Number(m[2]), 4);
      days.push({ date: m[1], count: LEVEL_TO_COUNT[level] });
    }
    if (days.length === 0) return null;
    days.sort((a, b) => a.date.localeCompare(b.date));
    const weeks: { days: { count: number; date: string }[] }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      while (chunk.length < 7) chunk.push({ count: 0, date: '' });
      weeks.push({ days: chunk });
    }
    const trimmed = weeks.slice(-52);
    while (trimmed.length < 52) {
      trimmed.unshift({ days: Array.from({ length: 7 }, () => ({ count: 0, date: '' })) });
    }
    return { weeks: trimmed, username };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export async function handleOfficeGetLayout() {
  try {
    if (!existsSync(LAYOUT_FILE)) {
      return { layout: null };
    }
    const data = await readFile(LAYOUT_FILE, 'utf-8');
    const layout = JSON.parse(data);
    return { layout };
  } catch {
    return { layout: null };
  }
}

export async function handleOfficeSaveLayout(layout: unknown) {
  try {
    if (!existsSync(OFFICE_DIR)) {
      await mkdir(OFFICE_DIR, { recursive: true });
    }
    await writeFile(LAYOUT_FILE, JSON.stringify(layout, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function handleOfficeGetAgents(ctx: HostApiContext) {
  try {
    const result = await ctx.gatewayManager.rpc({
      module: 'agent',
      action: 'list',
      payload: {},
    });

    if (!result.ok) {
      return { agents: [] };
    }

    const agents = result.data?.agents || [];
    const activities = agents.map((agent: any) => ({
      agentId: agent.id,
      name: agent.name || agent.id,
      emoji: agent.emoji || '🤖',
      state: 'idle',
      lastActive: Date.now(),
      subagents: [],
    }));

    return { agents: activities };
  } catch {
    return { agents: [] };
  }
}

export async function handleOfficeGetContributions(ctx: HostApiContext) {
  try {
    const agentsResult = await ctx.gatewayManager.rpc({
      module: 'agent',
      action: 'list',
      payload: {},
    });

    if (!agentsResult.ok) {
      return { contributions: {} };
    }

    const agents = agentsResult.data?.agents || [];
    const contributions: Record<string, number> = {};

    for (const agent of agents) {
      const statsResult = await ctx.gatewayManager.rpc({
        module: 'agent',
        action: 'getStats',
        payload: { agentId: agent.id },
      });

      if (statsResult.ok && statsResult.data) {
        contributions[agent.id] = statsResult.data.messageCount || 0;
      }
    }

    return { contributions };
  } catch {
    return { contributions: {} };
  }
}

export async function handleOfficeGetGitHubContributions() {
  if (contributionsCache && Date.now() - contributionsCache.ts < CACHE_TTL_MS) {
    return contributionsCache.data;
  }

  const username = getGitHubUsername();
  if (!username) {
    return { error: 'no github username' };
  }

  const data = await fetchContributions(username);
  if (!data) {
    return { error: 'fetch failed' };
  }

  contributionsCache = { data, ts: Date.now() };
  return data;
}
