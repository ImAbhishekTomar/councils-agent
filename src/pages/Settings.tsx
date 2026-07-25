import { ArrowLeft, CheckCircle2, Eye, EyeOff, Globe2, KeyRound, Server, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import councilIcon from '../assets/logo/councils-icon-light.png';
import { clearProviderTokens, getProviderTokens, saveProviderTokens, settingsAvailableForThisBuild } from '../store/providerTokens';
import './Settings.css';

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';
const defaultServerTokenRunLimit = 2;

const openRouterSteps = [
  'Open openrouter.ai and sign in.',
  'Go to Settings, then Keys.',
  'Create a new API key and copy it once.',
  'Use free models only in Councils. The server also blocks non-free OpenRouter model ids.',
  'No extra scopes are needed beyond normal API access.',
];

const huggingFaceSteps = [
  'Open huggingface.co and sign in.',
  'Go to Settings, then Access Tokens.',
  'Create a fine-grained token.',
  'Enable the Inference permission named Make calls to Inference Providers.',
  'Keep repository write, billing administration, and organization management permissions off.',
];

const tavilySteps = [
  'Open tavily.com and sign in.',
  'Create or copy a Tavily API key from the dashboard.',
  'Use the hosted MCP URL if you want MCP-capable hosts to connect to Tavily too.',
  'Councils will search only when a council question needs fresh or sourced web context.',
];

function Settings() {
  const enabled = settingsAvailableForThisBuild();
  const [openRouterToken, setOpenRouterToken] = useState('');
  const [huggingFaceToken, setHuggingFaceToken] = useState('');
  const [tavilyToken, setTavilyToken] = useState('');
  const [tavilyMcpUrl, setTavilyMcpUrl] = useState('');
  const [serverTokenRunLimit, setServerTokenRunLimit] = useState(defaultServerTokenRunLimit);
  const [showTokens, setShowTokens] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const tokens = getProviderTokens();
    setOpenRouterToken(tokens.openRouterToken);
    setHuggingFaceToken(tokens.huggingFaceToken);
    setTavilyToken(tokens.tavilyToken);
    setTavilyMcpUrl(tokens.tavilyMcpUrl);
  }, []);

  useEffect(() => {
    fetch(`${apiBase}/api/models`)
      .then((response) => response.json())
      .then((data: { serverTokenRunLimit?: number }) => {
        const limit = data.serverTokenRunLimit;
        if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
          setServerTokenRunLimit(limit);
        }
      })
      .catch(() => undefined);
  }, []);

  const tokenType = showTokens ? 'text' : 'password';
  const hasTokens = useMemo(
    () => Boolean(openRouterToken.trim() || huggingFaceToken.trim() || tavilyToken.trim() || tavilyMcpUrl.trim()),
    [huggingFaceToken, openRouterToken, tavilyMcpUrl, tavilyToken],
  );

  const handleSave = () => {
    if (!enabled) return;
    saveProviderTokens({ openRouterToken, huggingFaceToken, tavilyToken, tavilyMcpUrl });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const handleClear = () => {
    clearProviderTokens();
    setOpenRouterToken('');
    setHuggingFaceToken('');
    setTavilyToken('');
    setTavilyMcpUrl('');
    setSaved(false);
  };

  return (
    <main className="settings-page">
      <nav className="settings-nav">
        <Link className="settings-brand" to="/">
          <img src={councilIcon} alt="" />
          <span>
            Councils
            <small>Provider settings</small>
          </span>
        </Link>
        <Link className="settings-back" to="/playground">
          <ArrowLeft size={17} />
          Playground
        </Link>
      </nav>

      <section className="settings-shell">
        <header className="settings-header">
          <div>
            <span className="settings-kicker">Keys stay in this browser</span>
            <h1>Connect model, image, and web extraction providers</h1>
          </div>
          <p>
            Deployed users can bring personal provider keys. If no OpenRouter token is saved, Councils uses the server token for up to {serverTokenRunLimit} council runs from this browser.
          </p>
        </header>

        {!enabled && (
          <div className="settings-alert">
            <Server size={18} />
            <span>These settings are disabled in local development. Local runs use your server environment variables instead.</span>
          </div>
        )}

        <section className="settings-grid">
          <form className="settings-form" onSubmit={(event) => event.preventDefault()}>
            <div className="form-title">
              <KeyRound size={19} />
              <h2>Personal tokens</h2>
            </div>

            <label className="settings-field">
              <span>OpenRouter API key</span>
              <input
                autoComplete="off"
                disabled={!enabled}
                onChange={(event) => setOpenRouterToken(event.target.value)}
                placeholder="sk-or-v1-..."
                type={tokenType}
                value={openRouterToken}
              />
            </label>

            <label className="settings-field">
              <span>Hugging Face access token</span>
              <input
                autoComplete="off"
                disabled={!enabled}
                onChange={(event) => setHuggingFaceToken(event.target.value)}
                placeholder="hf_..."
                type={tokenType}
                value={huggingFaceToken}
              />
            </label>

            <div className="settings-divider" />

            <div className="form-title compact">
              <Globe2 size={18} />
              <h2>Internet extraction</h2>
            </div>

            <label className="settings-field">
              <span>Tavily API key</span>
              <input
                autoComplete="off"
                disabled={!enabled}
                onChange={(event) => setTavilyToken(event.target.value)}
                placeholder="tvly-..."
                type={tokenType}
                value={tavilyToken}
              />
            </label>

            <label className="settings-field">
              <span>Tavily MCP URL</span>
              <input
                autoComplete="off"
                disabled={!enabled}
                onChange={(event) => setTavilyMcpUrl(event.target.value)}
                placeholder="https://mcp.tavily.com/mcp/"
                type={showTokens ? 'text' : 'password'}
                value={tavilyMcpUrl}
              />
            </label>

            <div className="settings-actions">
              <button className="settings-primary" disabled={!enabled} onClick={handleSave} type="button">
                <CheckCircle2 size={17} />
                {saved ? 'Saved' : 'Save tokens'}
              </button>
              <button className="settings-icon-button" disabled={!hasTokens} onClick={() => setShowTokens((current) => !current)} title={showTokens ? 'Hide tokens' : 'Show tokens'} type="button">
                {showTokens ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
              <button className="settings-icon-button danger" disabled={!hasTokens} onClick={handleClear} title="Clear saved tokens" type="button">
                <Trash2 size={17} />
              </button>
            </div>

            <div className="fallback-box">
              <strong>Server token fallback</strong>
              <p>
                No personal OpenRouter or Tavily key? The deployed app can use server-stored keys when configured. OpenRouter is limited to {serverTokenRunLimit} council runs from this browser.
              </p>
            </div>
          </form>

          <div className="guide-column">
            <GuideCard title="Create an OpenRouter token" steps={openRouterSteps} />
            <GuideCard title="Create a Hugging Face token" steps={huggingFaceSteps} />
            <GuideCard title="Connect Tavily web extraction" steps={tavilySteps} />
          </div>
        </section>
      </section>
    </main>
  );
}

function GuideCard({ title, steps }: { title: string; steps: string[] }) {
  return (
    <article className="guide-card">
      <h2>{title}</h2>
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </article>
  );
}

export default Settings;
