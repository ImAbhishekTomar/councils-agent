const openRouterTokenKey = 'councils.openrouterToken';
const huggingFaceTokenKey = 'councils.huggingFaceToken';
const clientIdKey = 'councils.clientId';

export type ProviderTokens = {
  openRouterToken: string;
  huggingFaceToken: string;
};

export function settingsAvailableForThisBuild() {
  if (import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

export function getProviderTokens(): ProviderTokens {
  if (typeof localStorage === 'undefined') {
    return { openRouterToken: '', huggingFaceToken: '' };
  }

  return {
    openRouterToken: localStorage.getItem(openRouterTokenKey) ?? '',
    huggingFaceToken: localStorage.getItem(huggingFaceTokenKey) ?? '',
  };
}

export function saveProviderTokens(tokens: ProviderTokens) {
  if (typeof localStorage === 'undefined') return;
  writeToken(openRouterTokenKey, tokens.openRouterToken);
  writeToken(huggingFaceTokenKey, tokens.huggingFaceToken);
}

export function clearProviderTokens() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(openRouterTokenKey);
  localStorage.removeItem(huggingFaceTokenKey);
}

export function getClientId() {
  if (typeof localStorage === 'undefined') return 'anonymous';

  const existing = localStorage.getItem(clientIdKey);
  if (existing) return existing;

  const nextId = globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(clientIdKey, nextId);
  return nextId;
}

function writeToken(key: string, token: string) {
  const cleaned = token.trim();
  if (cleaned) {
    localStorage.setItem(key, cleaned);
  } else {
    localStorage.removeItem(key);
  }
}
