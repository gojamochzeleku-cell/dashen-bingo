export const API_BASE: string =
  (((import.meta as any).env || {}).VITE_API_URL as string) ||
  (typeof window !== 'undefined' ? window.location.origin : '');
