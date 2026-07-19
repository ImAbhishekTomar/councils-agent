import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import { I18nProvider } from './i18n';
import Home from './pages/Home';

// Existing swarm playground - lazy so its dark-theme CSS only loads on that route.
const SwarmPlayground = lazy(() => import('./App'));

// Screens not yet ported from MiroFish. Placeholder keeps navigation working.
function ComingSoon({ label }: { label: string }) {
  const params = useParams();
  const id = Object.values(params)[0];
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: "'JetBrains Mono', monospace", color: '#000', background: '#fff', gap: 12 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.8rem', color: '#FF4500', letterSpacing: 1 }}>◇ {label}</div>
        <h1 style={{ fontWeight: 500 }}>Screen not ported yet</h1>
        {id && <p style={{ color: '#666' }}>id: {id}</p>}
        <Link to="/" style={{ color: '#FF4500' }}>← Back to Home</Link>
      </div>
    </div>
  );
}

function AppRoot() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Suspense fallback={<div style={{ padding: 40, fontFamily: 'monospace' }}>Loading…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/process/:projectId" element={<ComingSoon label="Step 1-5 / Process" />} />
            <Route path="/simulation/:simulationId" element={<ComingSoon label="Step 2 / Env Setup" />} />
            <Route path="/simulation/:simulationId/start" element={<ComingSoon label="Step 3 / Simulation Run" />} />
            <Route path="/report/:reportId" element={<ComingSoon label="Step 4 / Report" />} />
            <Route path="/interaction/:reportId" element={<ComingSoon label="Step 5 / Interaction" />} />
            <Route path="/playground" element={<SwarmPlayground />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </I18nProvider>
  );
}

export default AppRoot;
