/**
 * Application Configuration
 * Centralized configuration constants and helpers
 */

/**
 * Port configuration
 */
export const PORTS = {
  /** ShortClaw GUI development server port */
  SHORTCLAW_DEV: 5173,

  /** ShortClaw GUI production port (for reference) */
  SHORTCLAW_GUI: 23333,

  /** Local host API server port */
  SHORTCLAW_HOST_API: 13210,

  /** OpenClaw Gateway port */
  OPENCLAW_GATEWAY: 18789,
} as const;

/**
 * Get port from environment or default
 */
export function getPort(key: keyof typeof PORTS): number {
  const envKey = `SHORTCLAW_PORT_${key}`;
  const envValue = process.env[envKey];
  return envValue ? parseInt(envValue, 10) : PORTS[key];
}

/**
 * Application paths
 */
export const APP_PATHS = {
  /** OpenClaw configuration directory */
  OPENCLAW_CONFIG: '~/.openclaw',

  /** ShortClaw configuration directory */
  SHORTCLAW_CONFIG: '~/.shortclaw',

  /** Log files directory */
  LOGS: '~/.shortclaw/logs',
} as const;

/**
 * Update channels
 */
export const UPDATE_CHANNELS = ['stable', 'beta', 'dev'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/**
 * Default update configuration
 */
export const UPDATE_CONFIG = {
  /** Check interval in milliseconds (6 hours) */
  CHECK_INTERVAL: 6 * 60 * 60 * 1000,

  /** Default update channel */
  DEFAULT_CHANNEL: 'stable' as UpdateChannel,

  /** Auto download updates */
  AUTO_DOWNLOAD: false,

  /** Show update notifications */
  SHOW_NOTIFICATION: true,
};

/**
 * Gateway configuration
 */
export const GATEWAY_CONFIG = {
  /** WebSocket reconnection delay (ms) */
  RECONNECT_DELAY: 5000,

  /** RPC call timeout (ms) */
  RPC_TIMEOUT: 30000,

  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL: 30000,

  /** Maximum startup retries */
  MAX_STARTUP_RETRIES: 30,

  /** Startup retry interval (ms) */
  STARTUP_RETRY_INTERVAL: 1000,
};
