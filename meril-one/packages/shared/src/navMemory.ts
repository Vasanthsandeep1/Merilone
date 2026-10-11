import * as SecureStore from 'expo-secure-store';

// Remembers the detail screen the user was on, so the app reopens on it.
// Android may close the app while it's in the background (e.g. while the
// phone's dialer is open after tapping Call); without this it would restart
// on Home. Kept for 30 minutes; only { screen, params }, so it stays tiny.
const KEY = (app: string) => `m1_nav_${app}`;
const MAX_AGE_MS = 30 * 60 * 1000;

type Saved = { screen: string; params: Record<string, unknown>; at: number };

// The stack's top screen if it's one of `screens`, else null.
function topOf(state: any, screens: string[]): { screen: string; params: Record<string, unknown> } | null {
  const r = state?.routes?.[state.index ?? state.routes.length - 1];
  return r && screens.includes(r.name) ? { screen: r.name, params: r.params || {} } : null;
}

export function saveNavState(app: string, state: any, screens: string[]) {
  const top = topOf(state, screens);
  const p = top
    ? SecureStore.setItemAsync(KEY(app), JSON.stringify({ ...top, at: Date.now() } satisfies Saved))
    : SecureStore.deleteItemAsync(KEY(app));
  p.catch(() => {});
}

// initialState for NavigationContainer: Main (tabs) with the saved screen on
// top, or undefined (start normally).
export async function loadNavState(app: string): Promise<any | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(KEY(app));
    if (!raw) return undefined;
    const s = JSON.parse(raw) as Saved;
    if (!s?.screen || Date.now() - s.at > MAX_AGE_MS) return undefined;
    return { index: 1, routes: [{ name: 'Main' }, { name: s.screen, params: s.params }] };
  } catch { return undefined; }
}
