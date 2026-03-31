import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getAgentActivities } from '../agent-activity';
import { listAgentsSnapshot } from '../../utils/agent-config';

export async function handleAgentActivityRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agent-activity' && req.method === 'GET') {
    try {
      const snapshot = await listAgentsSnapshot();
      const agentList = snapshot.agents || [];
      const activities = await getAgentActivities(agentList);

      sendJson(res, 200, { agents: activities });
    } catch (error) {
      sendJson(res, 500, { agents: [], error: String(error) });
    }
    return true;
  }

  return false;
}
