import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loginApi } from '@/api/authApi';
import type { User } from '@/types/auth';

interface AuthState {
  user: User | null;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      login: async (username, password) => {
        const user = await loginApi(username, password);
        set({ user });
        return user;
      },
      logout: () => set({ user: null }),
    }),
    {
      name: 'audit-auth-store-v3',
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
