import { app } from 'electron';
import { join } from 'path';
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';

const OPENCLAW_HOME = join(homedir(), '.openclaw');
const AGENTS_DIR = join(OPENCLAW_HOME, 'agents');

export interface AgentActivity {
  agentId: string;
  name: string;
  emoji: string;
  state: 'idle' | 'working' | 'waiting' | 'offline';
  currentTool?: string;
  toolStatus?: string;
  lastActive: number;
  subagents?: any[];
}

async function getAgentLastActive(agentId: string): Promise<number> {
  const agentSessionsDir = join(AGENTS_DIR, agentId, 'sessions');
  if (!existsSync(agentSessionsDir)) return 0;

  try {
    const files = await readdir(agentSessionsDir);
    let lastActive = 0;
    for (const file of files) {
      const filePath = join(agentSessionsDir, file);
      const stats = await stat(filePath);
      if (stats.mtimeMs > lastActive) {
        lastActive = stats.mtimeMs;
      }
    }
    return lastActive;
  } catch {
    return 0;
  }
}

function determineAgentState(lastActive: number): 'idle' | 'working' | 'waiting' | 'offline' {
  if (lastActive === 0) return 'offline';
  const now = Date.now();
  const timeDiff = now - lastActive;
  if (timeDiff > 10 * 60 * 1000) return 'offline';
  if (timeDiff <= 2 * 60 * 1000) return 'working';
  return 'idle';
}

export async function getAgentActivities(agentList: any[]): Promise<AgentActivity[]> {
  const activities: AgentActivity[] = [];

  for (const agent of agentList) {
    const lastActive = await getAgentLastActive(agent.id);
    const state = determineAgentState(lastActive);

    activities.push({
      agentId: agent.id,
      name: agent.name || agent.id,
      emoji: agent.emoji || '🤖',
      state,
      lastActive,
      subagents: [],
    });
  }

  return activities;
}
