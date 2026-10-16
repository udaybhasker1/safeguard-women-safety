// Dev: Vite proxies /api to the backend. Production: same server, same origin.
// Only set VITE_API_URL if the backend is hosted on a different domain.
export const API = import.meta.env.VITE_API_URL || "/api";

const STORAGE_KEY = "safeguard_session";


export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // storage unavailable - user just has to log in again next time
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}


export async function apiFetch(path, options = {}) {
  const session = loadSession();

  const headers = { ...(options.headers || {}) };

  if (session && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  const response = await fetch(`${API}${path}`, { ...options, headers });

  if (response.status === 401 && session) {
    window.dispatchEvent(new Event("safeguard-unauthorized"));
  }

  return response;
}
