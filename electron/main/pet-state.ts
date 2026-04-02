import type { GatewayManager } from '../gateway/manager';
import { getAgentActivities } from '../api/agent-activity';
import { listAgentsSnapshot } from '../utils/agent-config';
import {
  createPetStateSnapshot,
  type PetStateSnapshot,
} from '../../shared/pet';

type Listener = (snapshot: PetStateSnapshot) => void;
type AgentRuntimeState = 'idle' | 'working' | 'waiting' | 'offline';

const POLL_INTERVAL_MS = 3_000;

export class PetStateService {
  private readonly listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private currentState = createPetStateSnapshot('idle');
  private readonly handleGatewayStatus = () => {
    void this.refresh();
  };
  private readonly handleGatewayError = () => {
    void this.refresh();
  };

  constructor(private readonly gatewayManager: GatewayManager) {}

  getSnapshot(): PetStateSnapshot {
    return this.currentState;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.pollTimer) {
      return;
    }
    this.gatewayManager.on('status', this.handleGatewayStatus);
    this.gatewayManager.on('error', this.handleGatewayError);
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, POLL_INTERVAL_MS);
    void this.refresh();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.gatewayManager.off('status', this.handleGatewayStatus);
    this.gatewayManager.off('error', this.handleGatewayError);
  }

  async refresh(): Promise<PetStateSnapshot> {
    const gatewayState = this.gatewayManager.getStatus().state;
    if (gatewayState === 'error') {
      return this.setState(createPetStateSnapshot('error', 'gateway-error'));
    }

    try {
      const snapshot = await listAgentsSnapshot();
      const activities = await getAgentActivities(snapshot.agents || []);
      const hasWorkingAgent = activities.some((agent) => this.isWorkingState(agent.state));
      return this.setState(createPetStateSnapshot(hasWorkingAgent ? 'working' : 'idle'));
    } catch {
      return this.setState(createPetStateSnapshot('error', 'activity-fetch-failed'));
    }
  }

  private isWorkingState(state: AgentRuntimeState): boolean {
    return state === 'working' || state === 'waiting';
  }

  private setState(nextState: PetStateSnapshot): PetStateSnapshot {
    const changed =
      this.currentState.status !== nextState.status || this.currentState.reason !== nextState.reason;

    this.currentState = nextState;
    if (changed) {
      for (const listener of this.listeners) {
        listener(nextState);
      }
    }
    return nextState;
  }
}
