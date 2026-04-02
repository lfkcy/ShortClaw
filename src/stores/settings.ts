/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { resolveSupportedLanguage } from '../../shared/language';
import type { AppSettings } from '../../electron/utils/store';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;

  // Setup
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setDevModeUnlocked: (value: boolean) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

function createDefaultSettings() {
  return {
    theme: 'system' as Theme,
    language: resolveSupportedLanguage(
      typeof navigator !== 'undefined' ? navigator.language : undefined
    ),
    startMinimized: false,
    launchAtStartup: false,
    telemetryEnabled: true,
    gatewayAutoStart: true,
    gatewayPort: 18789,
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
    updateChannel: 'stable' as UpdateChannel,
    autoCheckUpdate: true,
    autoDownloadUpdate: false,
    sidebarCollapsed: false,
    devModeUnlocked: false,
    setupComplete: false,
  };
}

let settingsSyncBound = false;

function toSettingsPatch(patch: Partial<AppSettings>): Partial<SettingsState> {
  const nextPatch: Partial<SettingsState> = {};

  if (patch.theme !== undefined) nextPatch.theme = patch.theme;
  if (patch.language !== undefined) {
    nextPatch.language = resolveSupportedLanguage(patch.language);
  }
  if (patch.startMinimized !== undefined) nextPatch.startMinimized = patch.startMinimized;
  if (patch.launchAtStartup !== undefined) nextPatch.launchAtStartup = patch.launchAtStartup;
  if (patch.telemetryEnabled !== undefined) nextPatch.telemetryEnabled = patch.telemetryEnabled;
  if (patch.gatewayAutoStart !== undefined) nextPatch.gatewayAutoStart = patch.gatewayAutoStart;
  if (patch.gatewayPort !== undefined) nextPatch.gatewayPort = patch.gatewayPort;
  if (patch.proxyEnabled !== undefined) nextPatch.proxyEnabled = patch.proxyEnabled;
  if (patch.proxyServer !== undefined) nextPatch.proxyServer = patch.proxyServer;
  if (patch.proxyHttpServer !== undefined) nextPatch.proxyHttpServer = patch.proxyHttpServer;
  if (patch.proxyHttpsServer !== undefined) nextPatch.proxyHttpsServer = patch.proxyHttpsServer;
  if (patch.proxyAllServer !== undefined) nextPatch.proxyAllServer = patch.proxyAllServer;
  if (patch.proxyBypassRules !== undefined) {
    nextPatch.proxyBypassRules = patch.proxyBypassRules;
  }
  if (patch.updateChannel !== undefined) nextPatch.updateChannel = patch.updateChannel;
  if (patch.autoCheckUpdate !== undefined) nextPatch.autoCheckUpdate = patch.autoCheckUpdate;
  if (patch.autoDownloadUpdate !== undefined) {
    nextPatch.autoDownloadUpdate = patch.autoDownloadUpdate;
  }
  if (patch.sidebarCollapsed !== undefined) nextPatch.sidebarCollapsed = patch.sidebarCollapsed;
  if (patch.devModeUnlocked !== undefined) nextPatch.devModeUnlocked = patch.devModeUnlocked;
  if (patch.setupComplete !== undefined) nextPatch.setupComplete = patch.setupComplete;

  return nextPatch;
}

function bindSettingsSync(set: (partial: Partial<SettingsState>) => void): void {
  if (settingsSyncBound) {
    return;
  }

  const unsubscribe = window.electron.ipcRenderer.on(
    'settings:changed',
    (patch: Partial<AppSettings>) => {
      const nextPatch = toSettingsPatch(patch);
      if (nextPatch.language) {
        i18n.changeLanguage(nextPatch.language);
      }

      set(nextPatch);
    },
  );

  if (typeof unsubscribe === 'function') {
    settingsSyncBound = true;
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...createDefaultSettings(),

      init: async () => {
        bindSettingsSync(set);
        try {
          const settings = await hostApiFetch<Partial<AppSettings>>('/api/settings');
          const nextPatch = toSettingsPatch(settings);
          set((state) => ({
            ...state,
            ...nextPatch,
          }));
          if (nextPatch.language) {
            i18n.changeLanguage(nextPatch.language);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApiFetch('/api/settings/theme', {
          method: 'PUT',
          body: JSON.stringify({ value: theme }),
        }).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApiFetch('/api/settings/language', {
          method: 'PUT',
          body: JSON.stringify({ value: resolvedLanguage }),
        }).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApiFetch('/api/settings/launchAtStartup', {
          method: 'PUT',
          body: JSON.stringify({ value: launchAtStartup }),
        }).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApiFetch('/api/settings/telemetryEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: telemetryEnabled }),
        }).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApiFetch('/api/settings/gatewayAutoStart', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayAutoStart }),
        }).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApiFetch('/api/settings/gatewayPort', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayPort }),
        }).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => set({ autoCheckUpdate }),
      setAutoDownloadUpdate: (autoDownloadUpdate) => set({ autoDownloadUpdate }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void hostApiFetch('/api/settings/devModeUnlocked', {
          method: 'PUT',
          body: JSON.stringify({ value: devModeUnlocked }),
        }).catch(() => { });
      },
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(createDefaultSettings()),
    }),
    {
      name: 'shortclaw-settings',
    }
  )
);
