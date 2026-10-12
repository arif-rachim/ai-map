import i18n from '../i18n';
import { embed, useStore } from '../store';
import { api, setApiToken } from './api';

const KEY = 'aimap.adminToken';

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function store(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the session lasts until the page is closed
  }
}

/** The session ended on the server (expired, or the password changed): back to read-only. */
function expired(): void {
  setApiToken(null);
  if (!embed.enabled) store(null);
  if (useStore.getState().admin) useStore.getState().notify(i18n.t('admin.expired'));
  useStore.getState().setAuth(false);
}

/** Restores the admin session saved in this browser (the full app only) and asks the server whether it is valid. */
export async function initAuth(): Promise<void> {
  setApiToken(embed.enabled ? null : stored(), expired);
  await refreshSession();
}

async function refreshSession(): Promise<void> {
  const session = await api.session().catch(() => ({ admin: false, loginEnabled: false }));
  if (!session.admin) setApiToken(null);
  useStore.getState().setAuth(session.admin, session.loginEnabled);
}

export async function login(password: string): Promise<void> {
  const { token } = await api.login(password);
  setApiToken(token);
  if (!embed.enabled) store(token);
  useStore.getState().setAuth(true);
}

export function logout(): void {
  setApiToken(null);
  store(null);
  useStore.getState().setAuth(false);
}

/** Embed: the host page hands over a token (ADMIN_API_TOKEN or a session token); kept in memory only. */
export async function applyToken(token: string | null): Promise<boolean> {
  setApiToken(token);
  await refreshSession();
  return useStore.getState().admin;
}
