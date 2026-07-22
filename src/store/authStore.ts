import { create } from 'zustand';
import { getCurrentUserApi, loginApi, logoutApi } from '@/api/authApi';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '@/api/authSession';
import type { User } from '@/types/auth';
import { runtimeConfig } from '@/config/runtime';
import { resetUserScopedState } from './resetUserScopedState';

interface AuthState {
  user: User | null;
  initialized: boolean;
  initializationError: string | null;
  initialize: (force?: boolean) => Promise<void>;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

let initializationPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initialized: false,
  initializationError: null,
  initialize: async (force = false) => {
    if (!force && get().initialized) return;
    if (initializationPromise) return initializationPromise;

    set({ initialized: false, initializationError: null });
    const task = (async () => {
      if (runtimeConfig.dataMode !== 'api' && !getAccessToken()) {
        set({ user: null, initialized: true });
        return;
      }
      try {
        const user = await getCurrentUserApi();
        set({ user, initialized: true, initializationError: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : '恢复登录状态失败';
        set({
          user: null,
          initialized: true,
          initializationError: runtimeConfig.dataMode === 'api' ? null : getAccessToken() ? message : null,
        });
      }
    })();
    initializationPromise = task;
    try {
      await task;
    } finally {
      if (initializationPromise === task) initializationPromise = null;
    }
  },
  login: async (username, password) => {
    const session = await loginApi(username, password);
    resetUserScopedState();
    if (runtimeConfig.dataMode !== 'api') setAccessToken(session.accessToken);
    else clearAccessToken();
    set({ user: session.user, initialized: true, initializationError: null });
    return session.user;
  },
  logout: async () => {
    let failure: unknown;
    try {
      if (runtimeConfig.dataMode === 'api' || getAccessToken()) await logoutApi();
    } catch (error) {
      failure = error;
    } finally {
      clearAccessToken();
      resetUserScopedState();
      set({ user: null, initialized: true, initializationError: null });
    }
    if (failure) throw failure;
  },
}));

window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, () => {
  resetUserScopedState();
  useAuthStore.setState({ user: null, initialized: true, initializationError: null });
  if (window.location.pathname !== '/login') window.location.replace('/login');
});
