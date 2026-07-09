import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loginApi } from '@/api/authApi';
import type { Role, User } from '@/types/auth';

interface AuthState {
  user: User | null;
  login: (username: Role, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      login: async (username, password) => {
        const user = await loginApi(username, password);
        set({ user });
      },
      logout: () => set({ user: null }),
    }),
    {
      name: 'audit-auth-store-v3',
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
