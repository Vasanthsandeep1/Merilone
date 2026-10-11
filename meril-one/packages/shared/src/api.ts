import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Talks to the B2G backend's Meril One API (/api/m1, see
// backend/controllers/merilOneController.js).
//
// Base URL: EXPO_PUBLIC_API_URL if set (e.g. a deployed server); otherwise
// the same address the app was opened from (hostUri: the computer's Wi-Fi
// address, or the tunnel link). The Expo dev server forwards /api and
// /uploads to the backend (see meril-one/metro.proxy.js), so one address
// serves both — and it works through a tunnel when Wi-Fi blocks devices.
export function apiBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest2?.extra?.expoGo?.debuggerHost || 'localhost:8081';
  return `http://${hostUri}/api/m1`;
}

export type Role = 'customer' | 'engineer';
const TOKEN_KEY = (role: Role) => `m1_token_${role}`;

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const auth = {
  async load(role: Role) { token = await SecureStore.getItemAsync(TOKEN_KEY(role)); return token; },
  async save(role: Role, t: string) { token = t; await SecureStore.setItemAsync(TOKEN_KEY(role), t); },
  async clear(role: Role) { token = null; await SecureStore.deleteItemAsync(TOKEN_KEY(role)); },
  onUnauthorized(fn: () => void) { onUnauthorized = fn; },
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check that your phone and computer are on the same Wi-Fi and the backend is running.", 0);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && token) onUnauthorized?.();
  if (!res.ok || data?.success === false) throw new ApiError(data?.message || `Something went wrong (${res.status})`, res.status);
  return data as T;
}

// Full URL of a file the backend serves (e.g. "/uploads/m1-problems/x.jpg").
export const fileUrl = (p: string) => (/^(https?|data):/.test(p) ? p : `${apiBaseUrl().replace(/\/api\/m1$/, '')}${p}`);

// Uploads one photo (multipart, field "photo"); returns the saved path.
// Uses XMLHttpRequest, not fetch: Expo's built-in fetch doesn't send React
// Native file parts ({ uri, name, type }), so the upload failed before it
// left the phone. XMLHttpRequest reads the file from its uri and sends it.
export function uploadPhoto(path: string, uri: string, mimeType = 'image/jpeg'): Promise<string> {
  const form = new FormData();
  const ext = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  form.append('photo', { uri, name: `photo.${ext}`, type: mimeType } as any);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBaseUrl()}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 60000;
    xhr.onload = () => {
      let data: any = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401 && token) onUnauthorized?.();
      if (xhr.status >= 200 && xhr.status < 300 && data?.success) resolve(data.path as string);
      else reject(new ApiError(data?.message || `Could not upload the photo (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Can't reach the server to upload the photo.", 0));
    xhr.ontimeout = () => reject(new ApiError('The photo upload took too long. Try again on a better connection.', 0));
    xhr.send(form);
  });
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};
