import { useNavigate } from 'react-router-dom';
import HistoryDatabase from '../components/HistoryDatabase';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useI18n } from '../i18n';
import councilIcon from '../assets/logo/councils-icon-light.png';
import './Home.css';

function Home() {
  const navigate = useNavigate();
  const { t, tNodes } = useI18n();

  const startCouncil = () => {
    navigate('/playground');
  };

  const workflowSteps = ['01', '02', '03', '04', '05'] as const;
  return (
    <div className="home-container">
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
          <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noreferrer" className="github-link">
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

        <div className="animate-rise delay-three">
          <HistoryDatabase />
        </div>
      </div>
    </div>
  );
}

export default Home;
