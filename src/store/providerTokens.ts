const openRouterTokenKey = 'councils.openrouterToken';
const huggingFaceTokenKey = 'councils.huggingFaceToken';
const tavilyTokenKey = 'councils.tavilyToken';
const tavilyMcpUrlKey = 'councils.tavilyMcpUrl';
const clientIdKey = 'councils.clientId';

export type ProviderTokens = {
  openRouterToken: string;
  huggingFaceToken: string;
  tavilyToken: string;
  tavilyMcpUrl: string;
};

export function settingsAvailableForThisBuild() {
  if (import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

export function getProviderTokens(): ProviderTokens {
  if (typeof localStorage === 'undefined') {
    return { openRouterToken: '', huggingFaceToken: '', tavilyToken: '', tavilyMcpUrl: '' };
  }

  return {
    openRouterToken: localStorage.getItem(openRouterTokenKey) ?? '',
    huggingFaceToken: localStorage.getItem(huggingFaceTokenKey) ?? '',
    tavilyToken: localStorage.getItem(tavilyTokenKey) ?? '',
    tavilyMcpUrl: localStorage.getItem(tavilyMcpUrlKey) ?? '',
  };
}

export function saveProviderTokens(tokens: ProviderTokens) {
  if (typeof localStorage === 'undefined') return;
  writeToken(openRouterTokenKey, tokens.openRouterToken);
  writeToken(huggingFaceTokenKey, tokens.huggingFaceToken);
  writeToken(tavilyTokenKey, tokens.tavilyToken);
  writeToken(tavilyMcpUrlKey, tokens.tavilyMcpUrl);
}

export function clearProviderTokens() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(openRouterTokenKey);
  localStorage.removeItem(huggingFaceTokenKey);
  localStorage.removeItem(tavilyTokenKey);
  localStorage.removeItem(tavilyMcpUrlKey);
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
