/**
 * User State Store
 * Manages ShortAPI OAuth user profile and authentication state.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';

interface UserProfile {
  name: string;
  avatar: string;
  email: string;
}

interface UserState {
  profile: UserProfile | null;
  isAuthenticated: boolean;
  loading: boolean;

  fetchProfile: () => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
}

export const useUserStore = create<UserState>((set, get) => ({
  profile: null,
  isAuthenticated: false,
  loading: false,

  fetchProfile: async () => {
    if (get().loading) return;
    set({ loading: true });

    try {
      const result = await hostApiFetch<{
        authenticated: boolean;
        profile?: UserProfile;
      }>('/api/user/profile');

      if (result.authenticated && result.profile) {
        set({
          profile: result.profile,
          isAuthenticated: true,
          loading: false,
        });
      } else {
        set({
          profile: null,
          isAuthenticated: false,
          loading: false,
        });
      }
    } catch {
      set({
        profile: null,
        isAuthenticated: false,
        loading: false,
      });
    }
  },

  logout: async () => {
    try {
      await hostApiFetch('/api/user/logout', { method: 'POST' });
      // Refresh provider list after logout to update UI
      const { useProviderStore } = await import('./providers');
      await useProviderStore.getState().refreshProviderSnapshot();
    } catch (error) {
      console.error('Logout failed:', error);
    }
    get().clear();
  },

  clear: () => {
    set({
      profile: null,
      isAuthenticated: false,
      loading: false,
    });
  },
}));
