import { NeatGradient, type NeatConfig } from '@firecms/neat';
import { BrainCircuit, Download, Globe2, Image, KeyRound, RadioTower } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import councilIcon from '../assets/logo/councils-icon-light.png';
import HistoryDatabase from '../components/HistoryDatabase';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useI18n } from '../i18n';
import './Home.css';

function Home() {
  const navigate = useNavigate();
  const { t, tNodes } = useI18n();

  const startCouncil = () => {
    navigate('/playground');
  };

  const workflowSteps = ['01', '02', '03', '04', '05'] as const;
  const testFeatures = [
    { key: 'tokens', icon: KeyRound },
    { key: 'web', icon: Globe2 },
    { key: 'visuals', icon: Image },
    { key: 'streaming', icon: RadioTower },
    { key: 'export', icon: Download },
    { key: 'innerState', icon: BrainCircuit },
  ] as const;

  return (
    <div className="home-container">
      <NeatLandingBackground />
      <nav className="navbar">
        <div className="nav-brand" aria-label="Councils">
          <img src={councilIcon} alt="" className="nav-mark" />
          <div className="nav-brand-text">
            <span>Councils</span>
            <small>Agent discussion</small>
          </div>
        </div>
        <div className="nav-links">
          <LanguageSwitcher />
          <Link to="/settings" className="github-link">
            Settings
          </Link>
          <a href="https://github.com/ImAbhishekTomar/councils-agent" target="_blank" rel="noreferrer" className="github-link">
            {t('nav.visitGithub')} <span className="arrow">↗</span>
          </a>
        </div>
      </nav>

      <div className="main-content">
        <section className="hero-section">
          <div className="hero-copy animate-rise">
            <div className="tag-row animate-slide-in">
              <span className="orange-tag">
                <span className="tag-pulse" />
                {t('home.tagline')}
              </span>
              <span className="version-text">{t('home.version')}</span>
            </div>

            <h1 className="main-title animate-rise delay-one">
              <span className="typing-line typing-line-one">Convene</span>
              <span className="typing-line typing-line-two">Agents</span>
              <span className="typing-line typing-line-three gradient-text">Reach</span>
              <span className="typing-line typing-line-four gradient-text">Consensus</span>
              <span className="typing-cursor" aria-hidden="true" />
            </h1>

            <div className="hero-desc animate-rise delay-two">
              <p>
                <span>
                  {tNodes('home.heroDesc', {
                    brand: <span className="highlight-bold">{t('home.heroDescBrand')}</span>,
                    agentScale: <span className="highlight-orange">{t('home.heroDescAgentScale')}</span>,
                    optimalSolution: <span className="highlight-code">{t('home.heroDescOptimalSolution')}</span>,
                  })}
                </span>
              </p>
              <p className="slogan-text">
                {t('home.slogan')}
                <span className="blinking-cursor">_</span>
              </p>
            </div>

            <div className="hero-actions animate-rise delay-three">
              <button className="primary-hero-btn" onClick={startCouncil}>
                Start Council
                <span className="btn-arrow">→</span>
              </button>
              <div className="hero-note">Opens the agent council directly.</div>
            </div>
          </div>

          <div className="hero-visual animate-orbit-entry" aria-hidden="true">
            <div className="orbit-shell">
              <div className="orbit-ring orbit-ring-one" />
              <div className="orbit-ring orbit-ring-two" />
              <div className="orbit-ring orbit-ring-three" />
              <div className="center-node">
                <img src={councilIcon} alt="" />
                <span>Decision</span>
              </div>
              <span className="agent-node node-a">Frame</span>
              <span className="agent-node node-b">Risk</span>
              <span className="agent-node node-c">Build</span>
              <span className="agent-node node-d">Critique</span>
              <span className="agent-node node-e">Synthesis</span>
            </div>
            <div className="signal-strip">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </section>

        <section className="dashboard-section animate-rise delay-two">
          <div className="left-panel decision-panel">
            <div className="decision-summary">
              <div className="panel-header">
                <span className="status-dot" /> {t('home.systemStatus')}
              </div>

              <h2 className="section-title">{t('home.systemReady')}</h2>
              <p className="section-desc">{t('home.systemReadyDesc')}</p>

              <div className="metrics-row">
                <div className="metric-card">
                  <div className="metric-value">{t('home.metricLowCost')}</div>
                  <div className="metric-label">{t('home.metricLowCostDesc')}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{t('home.metricHighAvail')}</div>
                  <div className="metric-label">{t('home.metricHighAvailDesc')}</div>
                </div>
              </div>
            </div>

            <div className="steps-container">
              <div className="steps-header">
                <span className="diamond-icon" /> {t('home.workflowSequence')}
              </div>
              <div className="workflow-list">
                {workflowSteps.map((num, index) => (
                  <div className="workflow-item" style={{ animationDelay: `${0.1 + index * 0.08}s` }} key={num}>
                    <span className="step-num">{num}</span>
                    <div className="step-info">
                      <div className="step-title">{t(`home.step${num}Title`)}</div>
                      <div className="step-desc">{t(`home.step${num}Desc`)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="test-feature-section animate-rise delay-three">
          <div className="test-feature-header">
            <span>{t('home.testFeatureKicker')}</span>
            <h2>{t('home.testFeatureTitle')}</h2>
            <p>{t('home.testFeatureDesc')}</p>
          </div>

          <div className="test-feature-grid">
            {testFeatures.map(({ key, icon: Icon }) => (
              <article className="test-feature-card" key={key}>
                <span className={`test-feature-icon feature-${key}`}>
                  <Icon size={19} />
                </span>
                <div>
                  <h3>{t(`home.testFeature${key}Title`)}</h3>
                  <p>{t(`home.testFeature${key}Desc`)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="animate-rise delay-three">
          <HistoryDatabase />
        </div>
      </div>
    </div>
  );
}

const neatBackgroundConfig: NeatConfig = {
  colors: [
    { color: '#e15f37', enabled: true },
    { color: '#f5c84b', enabled: true },
    { color: '#16876a', enabled: true },
    { color: '#06b6d4', enabled: true },
    { color: '#315f9c', enabled: true },
    { color: '#6d5bd0', enabled: true },
  ],
  speed: 1.7,
  horizontalPressure: 2,
  verticalPressure: 4.2,
  waveFrequencyX: 2,
  waveFrequencyY: 2,
  waveAmplitude: 4.2,
  shadows: 13,
  highlights: 5,
  colorBrightness: 0.78,
  colorSaturation: 6.5,
  wireframe: true,
  colorBlending: 7,
  backgroundColor: '#05070d',
  backgroundAlpha: 1,
  grainScale: 0,
  grainSparsity: 0,
  grainIntensity: 0,
  grainSpeed: 0,
  resolution: 0.22,
  yOffset: 0,
  yOffsetWaveMultiplier: 1.3,
  yOffsetColorMultiplier: 2.6,
  yOffsetFlowMultiplier: 2.8,
  flowDistortionA: 2.4,
  flowDistortionB: 2.1,
  flowScale: 1.35,
  flowEase: 0.41,
  flowEnabled: false,
  enableProceduralTexture: false,
  transparentTextureVoid: false,
  textureVoidLikelihood: 0.06,
  textureVoidWidthMin: 10,
  textureVoidWidthMax: 500,
  textureBandDensity: 0.8,
  textureColorBlending: 0.06,
  textureSeed: 333,
  textureEase: 0.6,
  proceduralBackgroundColor: '#f5c84b',
  textureShapeTriangles: 20,
  textureShapeCircles: 15,
  textureShapeBars: 15,
  textureShapeSquiggles: 10,
  domainWarpEnabled: false,
  domainWarpIntensity: 0,
  domainWarpScale: 3,
  vignetteIntensity: 0.28,
  vignetteRadius: 0.82,
  fresnelEnabled: false,
  fresnelPower: 2,
  fresnelIntensity: 0.5,
  fresnelColor: '#ffffff',
  iridescenceEnabled: false,
  iridescenceIntensity: 0.5,
  iridescenceSpeed: 1,
  bloomIntensity: 0,
  bloomThreshold: 0.7,
  chromaticAberration: 0,
  shapeType: 'plane',
  shapeRotationX: 0,
  shapeRotationY: 0,
  shapeRotationZ: 0,
  shapeAutoRotateSpeedX: 0,
  shapeAutoRotateSpeedY: 0,
  sphereRadius: 15,
  torusRadius: 15,
  torusTube: 5,
  cylinderRadius: 10,
  cylinderHeight: 40,
  planeBend: 0,
  planeTwist: 0,
  silhouetteFade: 0.25,
  cylinderFade: 0.08,
  ribbonFade: 0.05,
  flatShading: true,
  cameraLock: true,
  cameraX: 0,
  cameraY: 0,
  cameraZ: 0,
  cameraRotationX: 0,
  cameraRotationY: 0,
  cameraRotationZ: 0,
  cameraZoom: 1,
};

function NeatLandingBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gradientRef = useRef<NeatGradient | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduceMotion.matches) return undefined;

    gradientRef.current = new NeatGradient({
      ref: canvas,
      ...neatBackgroundConfig,
    });

    const syncScroll = () => {
      if (gradientRef.current) {
        gradientRef.current.yOffset = window.scrollY;
      }
    };

    syncScroll();
    window.addEventListener('scroll', syncScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', syncScroll);
      gradientRef.current?.destroy();
      gradientRef.current = null;
    };
  }, []);

  return <canvas aria-hidden="true" className="neat-background-canvas" ref={canvasRef} />;
}

export default Home;
