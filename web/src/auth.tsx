import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Me } from './api.ts';

/** The signed-in user (or null). Every component that calls this shares one cached request. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api<Me | { user: null }>('/auth/me');
      return me.user ? (me as Me) : null;
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api('/auth/login', { body }),
    onSuccess: () => queryClient.resetQueries(),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; fullName: string }) => api('/auth/register', { body }),
    onSuccess: () => queryClient.resetQueries(),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(['me'], null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
}

export const DEMO_ACCOUNTS = [
  { email: 'musteri@demo.test', label: 'Müşteri', who: 'Deniz Aydın' },
  { email: 'isletme@demo.test', label: 'İşletme sahibi', who: 'Makas & Tarak' },
  { email: 'calisan@demo.test', label: 'Çalışan', who: 'Mert Yıldız, berber' },
] as const;
export const DEMO_PASSWORD = 'demo12345';
