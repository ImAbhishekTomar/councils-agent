import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import HistoryDatabase from '../components/HistoryDatabase';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useI18n } from '../i18n';
import { setPendingUpload } from '../store/pendingUpload';
import heroLogo from '../assets/logo/MiroFish_logo_left.jpeg';
import './Home.css';

const ACCEPTED = ['pdf', 'md', 'txt'];

function Home() {
  const navigate = useNavigate();
  const { t, tNodes } = useI18n();

  const [simulationRequirement, setSimulationRequirement] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Prompt-only gating: this app is question-driven, so a file is optional.
  const canSubmit = useMemo(() => simulationRequirement.trim() !== '', [simulationRequirement]);

  const triggerFileInput = () => {
    if (!loading) fileInput.current?.click();
  };

  const addFiles = (newFiles: File[]) => {
    const valid = newFiles.filter((file) => ACCEPTED.includes(file.name.split('.').pop()?.toLowerCase() ?? ''));
    setFiles((current) => [...current, ...valid]);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!loading) setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    if (loading) return;
    addFiles(Array.from(event.dataTransfer.files));
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const startSimulation = () => {
    if (!canSubmit || loading) return;
    setPendingUpload(files, simulationRequirement);
    // Run the existing Ollama swarm engine with the typed prompt. The MiroFish
    // Process pipeline isn't ported yet, so route into the working playground.
    navigate('/playground');
  };

  return (
    <div className="home-container">
      <nav className="navbar">
        <div className="nav-brand">MIROFISH</div>
        <div className="nav-links">
          <LanguageSwitcher />
          <a href="https://github.com/666ghj/MiroFish" target="_blank" rel="noreferrer" className="github-link">
            {t('nav.visitGithub')} <span className="arrow">↗</span>
          </a>
        </div>
      </nav>

      <div className="main-content">
        <section className="hero-section">
          <div className="hero-left">
            <div className="tag-row">
              <span className="orange-tag">{t('home.tagline')}</span>
              <span className="version-text">{t('home.version')}</span>
            </div>

            <h1 className="main-title">
              {t('home.heroTitle1')}
              <br />
              <span className="gradient-text">{t('home.heroTitle2')}</span>
            </h1>

            <div className="hero-desc">
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

            <div className="decoration-square" />
          </div>

          <div className="hero-right">
            <div className="logo-container">
              <img src={heroLogo} alt="MiroFish Logo" className="hero-logo" />
            </div>
            <button className="scroll-down-btn" onClick={scrollToBottom}>
              ↓
            </button>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="left-panel">
            <div className="panel-header">
              <span className="status-dot">■</span> {t('home.systemStatus')}
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

            <div className="steps-container">
              <div className="steps-header">
                <span className="diamond-icon">◇</span> {t('home.workflowSequence')}
              </div>
              <div className="workflow-list">
                {(['01', '02', '03', '04', '05'] as const).map((num) => (
                  <div className="workflow-item" key={num}>
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

          <div className="right-panel">
            <div className="console-box">
              <div className="console-section">
                <div className="console-header">
                  <span className="console-label">{t('home.realitySeed')}</span>
                  <span className="console-meta">{t('home.supportedFormats')}</span>
                </div>

                <div
                  className={`upload-zone ${isDragOver ? 'drag-over' : ''} ${files.length > 0 ? 'has-files' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={triggerFileInput}
                >
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept=".pdf,.md,.txt"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                    disabled={loading}
                  />

                  {files.length === 0 ? (
                    <div className="upload-placeholder">
                      <div className="upload-icon">↑</div>
                      <div className="upload-title">{t('home.dragToUpload')}</div>
                      <div className="upload-hint">{t('home.orBrowse')}</div>
                    </div>
                  ) : (
                    <div className="file-list">
                      {files.map((file, index) => (
                        <div key={index} className="file-item">
                          <span className="file-icon">📄</span>
                          <span className="file-name">{file.name}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(index);
                            }}
                            className="remove-btn"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="console-divider">
                <span>{t('home.inputParams')}</span>
              </div>

              <div className="console-section">
                <div className="console-header">
                  <span className="console-label">{t('home.simulationPrompt')}</span>
                </div>
                <div className="input-wrapper">
                  <textarea
                    value={simulationRequirement}
                    onChange={(e) => setSimulationRequirement(e.target.value)}
                    className="code-input"
                    placeholder={t('home.promptPlaceholder')}
                    rows={6}
                    disabled={loading}
                  />
                  <div className="model-badge">{t('home.engineBadge')}</div>
                </div>
              </div>

              <div className="console-section btn-section">
                <button className="start-engine-btn" onClick={startSimulation} disabled={!canSubmit || loading}>
                  <span>{loading ? t('home.initializing') : t('home.startEngine')}</span>
                  <span className="btn-arrow">→</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <HistoryDatabase />
      </div>
    </div>
  );
}

export default Home;
