import { app } from 'electron';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import type { HostApiContext } from './context';

const OFFICE_DIR = join(app.getPath('userData'), 'pixel-office');
const LAYOUT_FILE = join(OFFICE_DIR, 'layout.json');

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
      payload: {}
    });

    if (!result.ok) {
      return { agents: [] };
    }

    return { agents: result.data?.agents || [] };
  } catch {
    return { agents: [] };
  }
}

export async function handleOfficeGetContributions(ctx: HostApiContext) {
  try {
    const agentsResult = await ctx.gatewayManager.rpc({
      module: 'agent',
      action: 'list',
      payload: {}
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
        payload: { agentId: agent.id }
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
