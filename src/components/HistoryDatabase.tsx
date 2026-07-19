import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { getSimulationHistory, type SimulationHistoryItem } from '../api/simulation';
import './HistoryDatabase.css';

const CARDS_PER_ROW = 4;
const CARD_WIDTH = 280;
const CARD_HEIGHT = 280;
const CARD_GAP = 24;

const TRANSITION =
  'transform 700ms cubic-bezier(0.23, 1, 0.32, 1), opacity 700ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.3s ease, border-color 0.3s ease';

function HistoryDatabase() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [projects, setProjects] = useState<SimulationHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveringCard, setHoveringCard] = useState<number | null>(null);
  const [selectedProject, setSelectedProject] = useState<SimulationHistoryItem | null>(null);

  const historyContainer = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isAnimating = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingState = useRef<boolean | null>(null);
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      const response = await getSimulationHistory(20);
      if (response.success) setProjects(response.data ?? []);
    } catch (error) {
      console.error('Failed to load simulation history:', error);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Expand-on-scroll: fan the cards out into a grid once the section is in view.
  useEffect(() => {
    if (projects.length === 0) return;
    const el = historyContainer.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const shouldExpand = entry.isIntersecting;
          pendingState.current = shouldExpand;
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
            debounceTimer.current = null;
          }
          if (isAnimating.current) return;
          if (shouldExpand === isExpandedRef.current) {
            pendingState.current = null;
            return;
          }
          const delay = shouldExpand ? 50 : 200;
          debounceTimer.current = setTimeout(() => {
            if (isAnimating.current) return;
            if (pendingState.current === null || pendingState.current === isExpandedRef.current) return;
            isAnimating.current = true;
            setIsExpanded(pendingState.current);
            pendingState.current = null;
            setTimeout(() => {
              isAnimating.current = false;
              if (pendingState.current !== null && pendingState.current !== isExpandedRef.current) {
                debounceTimer.current = setTimeout(() => {
                  if (pendingState.current !== null && pendingState.current !== isExpandedRef.current) {
                    isAnimating.current = true;
                    setIsExpanded(pendingState.current);
                    pendingState.current = null;
                    setTimeout(() => {
                      isAnimating.current = false;
                    }, 750);
                  }
                }, 100);
              }
            }, 750);
          }, delay);
        });
      },
      { threshold: [0.4, 0.6, 0.8], rootMargin: '0px 0px -150px 0px' },
    );

    observer.observe(el);
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [projects.length]);

  const containerStyle = useMemo<CSSProperties>(() => {
    if (!isExpanded) return { minHeight: '420px' };
    const total = projects.length;
    if (total === 0) return { minHeight: '280px' };
    const rows = Math.ceil(total / CARDS_PER_ROW);
    const expandedHeight = rows * CARD_HEIGHT + (rows - 1) * CARD_GAP + 10;
    return { minHeight: `${expandedHeight}px` };
  }, [isExpanded, projects.length]);

  const getCardStyle = (index: number): CSSProperties => {
    const total = projects.length;
    if (isExpanded) {
      const row = Math.floor(index / CARDS_PER_ROW);
      const currentRowStart = row * CARDS_PER_ROW;
      const currentRowCards = Math.min(CARDS_PER_ROW, total - currentRowStart);
      const rowWidth = currentRowCards * CARD_WIDTH + (currentRowCards - 1) * CARD_GAP;
      const startX = -(rowWidth / 2) + CARD_WIDTH / 2;
      const colInRow = index % CARDS_PER_ROW;
      const x = startX + colInRow * (CARD_WIDTH + CARD_GAP);
      const y = 20 + row * (CARD_HEIGHT + CARD_GAP);
      return { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(1)`, zIndex: 100 + index, opacity: 1, transition: TRANSITION };
    }
    const centerIndex = (total - 1) / 2;
    const offset = index - centerIndex;
    const x = offset * 35;
    const y = 25 + Math.abs(offset) * 8;
    const r = offset * 3;
    const s = 0.95 - Math.abs(offset) * 0.05;
    return { transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`, zIndex: 10 + index, opacity: 1, transition: TRANSITION };
  };

  const getProgressClass = (sim: SimulationHistoryItem) => {
    const current = sim.current_round || 0;
    const total = sim.total_rounds || 0;
    if (total === 0 || current === 0) return 'not-started';
    if (current >= total) return 'completed';
    return 'in-progress';
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toISOString().slice(0, 10);
    } catch {
      return dateStr?.slice(0, 10) || '';
    }
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    } catch {
      return '';
    }
  };

  const truncateText = (text?: string, maxLength = 55) => {
    if (!text) return '';
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  };

  const getSimulationTitle = (requirement?: string) => {
    if (!requirement) return t('history.untitledSimulation');
    const title = requirement.slice(0, 20);
    return requirement.length > 20 ? title + '...' : title;
  };

  const formatSimulationId = (simulationId?: string) => {
    if (!simulationId) return 'SIM_UNKNOWN';
    const prefix = simulationId.replace('sim_', '').slice(0, 6);
    return `SIM_${prefix.toUpperCase()}`;
  };

  const formatRounds = (sim: SimulationHistoryItem) => {
    const current = sim.current_round || 0;
    const total = sim.total_rounds || 0;
    if (total === 0) return t('history.notStarted');
    return t('history.roundsProgress', { current, total });
  };

  const getFileType = (filename?: string) => {
    if (!filename) return 'other';
    const ext = filename.split('.').pop()?.toLowerCase();
    const typeMap: Record<string, string> = {
      pdf: 'pdf',
      doc: 'doc',
      docx: 'doc',
      xls: 'xls',
      xlsx: 'xls',
      csv: 'xls',
      ppt: 'ppt',
      pptx: 'ppt',
      txt: 'txt',
      md: 'txt',
      json: 'code',
      jpg: 'img',
      jpeg: 'img',
      png: 'img',
      gif: 'img',
      zip: 'zip',
      rar: 'zip',
      '7z': 'zip',
    };
    return (ext && typeMap[ext]) || 'other';
  };

  const getFileTypeLabel = (filename?: string) => {
    if (!filename) return 'FILE';
    return filename.split('.').pop()?.toUpperCase() || 'FILE';
  };

  const truncateFilename = (filename?: string, maxLength = 20) => {
    if (!filename) return t('history.unknownFile');
    if (filename.length <= maxLength) return filename;
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const nameWithoutExt = filename.slice(0, filename.length - ext.length);
    return nameWithoutExt.slice(0, maxLength - ext.length - 3) + '...' + ext;
  };

  const closeModal = () => setSelectedProject(null);

  const goToProject = () => {
    if (selectedProject?.project_id) {
      navigate(`/process/${selectedProject.project_id}`);
      closeModal();
    }
  };
  const goToSimulation = () => {
    if (selectedProject?.simulation_id) {
      navigate(`/simulation/${selectedProject.simulation_id}`);
      closeModal();
    }
  };
  const goToReport = () => {
    if (selectedProject?.report_id) {
      navigate(`/report/${selectedProject.report_id}`);
      closeModal();
    }
  };

  return (
    <div className={`history-database ${projects.length === 0 && !loading ? 'no-projects' : ''}`} ref={historyContainer}>
      {(projects.length > 0 || loading) && (
        <div className="tech-grid-bg">
          <div className="grid-pattern" />
          <div className="gradient-overlay" />
        </div>
      )}

      <div className="section-header">
        <div className="section-line" />
        <span className="section-title">{t('history.title')}</span>
        <div className="section-line" />
      </div>

      {projects.length > 0 && (
        <div className={`cards-container ${isExpanded ? 'expanded' : ''}`} style={containerStyle}>
          {projects.map((project, index) => (
            <div
              key={project.simulation_id}
              className={`project-card ${isExpanded ? 'expanded' : ''} ${hoveringCard === index ? 'hovering' : ''}`}
              style={getCardStyle(index)}
              onMouseEnter={() => setHoveringCard(index)}
              onMouseLeave={() => setHoveringCard(null)}
              onClick={() => setSelectedProject(project)}
            >
              <div className="card-header">
                <span className="card-id">{formatSimulationId(project.simulation_id)}</span>
                <div className="card-status-icons">
                  <span className={`status-icon ${project.project_id ? 'available' : 'unavailable'}`} title={t('history.graphBuild')}>
                    ◇
                  </span>
                  <span className="status-icon available" title={t('history.envSetup')}>
                    ◈
                  </span>
                  <span className={`status-icon ${project.report_id ? 'available' : 'unavailable'}`} title={t('history.analysisReport')}>
                    ◆
                  </span>
                </div>
              </div>

              <div className="card-files-wrapper">
                <div className="corner-mark top-left-only" />
                {project.files && project.files.length > 0 ? (
                  <div className="files-list">
                    {project.files.slice(0, 3).map((file, fileIndex) => (
                      <div key={fileIndex} className="file-item">
                        <span className={`file-tag ${getFileType(file.filename)}`}>{getFileTypeLabel(file.filename)}</span>
                        <span className="file-name">{truncateFilename(file.filename, 20)}</span>
                      </div>
                    ))}
                    {project.files.length > 3 && (
                      <div className="files-more">{t('history.moreFiles', { count: project.files.length - 3 })}</div>
                    )}
                  </div>
                ) : (
                  <div className="files-empty">
                    <span className="empty-file-icon">◇</span>
                    <span className="empty-file-text">{t('history.noFiles')}</span>
                  </div>
                )}
              </div>

              <h3 className="card-title">{getSimulationTitle(project.simulation_requirement)}</h3>
              <p className="card-desc">{truncateText(project.simulation_requirement, 55)}</p>

              <div className="card-footer">
                <div className="card-datetime">
                  <span className="card-date">{formatDate(project.created_at)}</span>
                  <span className="card-time">{formatTime(project.created_at)}</span>
                </div>
                <span className={`card-progress ${getProgressClass(project)}`}>
                  <span className="status-dot">●</span> {formatRounds(project)}
                </span>
              </div>
              <div className="card-bottom-line" />
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="loading-state">
          <span className="loading-spinner" />
          <span className="loading-text">{t('history.loadingText')}</span>
        </div>
      )}

      {selectedProject &&
        createPortal(
          <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
            <div className="modal-content">
              <div className="modal-header">
                <div className="modal-title-section">
                  <span className="modal-id">{formatSimulationId(selectedProject.simulation_id)}</span>
                  <span className={`modal-progress ${getProgressClass(selectedProject)}`}>
                    <span className="status-dot">●</span> {formatRounds(selectedProject)}
                  </span>
                  <span className="modal-create-time">
                    {formatDate(selectedProject.created_at)} {formatTime(selectedProject.created_at)}
                  </span>
                </div>
                <button className="modal-close" onClick={closeModal}>
                  ×
                </button>
              </div>

              <div className="modal-body">
                <div className="modal-section">
                  <div className="modal-label">{t('history.simRequirement')}</div>
                  <div className="modal-requirement">{selectedProject.simulation_requirement || t('common.none')}</div>
                </div>

                <div className="modal-section">
                  <div className="modal-label">{t('history.relatedFiles')}</div>
                  {selectedProject.files && selectedProject.files.length > 0 ? (
                    <div className="modal-files">
                      {selectedProject.files.map((file, index) => (
                        <div key={index} className="modal-file-item">
                          <span className={`file-tag ${getFileType(file.filename)}`}>{getFileTypeLabel(file.filename)}</span>
                          <span className="modal-file-name">{file.filename}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="modal-empty">{t('history.noRelatedFiles')}</div>
                  )}
                </div>
              </div>

              <div className="modal-divider">
                <span className="divider-line" />
                <span className="divider-text">{t('history.replayTitle')}</span>
                <span className="divider-line" />
              </div>

              <div className="modal-actions">
                <button className="modal-btn btn-project" onClick={goToProject} disabled={!selectedProject.project_id}>
                  <span className="btn-step">Step1</span>
                  <span className="btn-icon">◇</span>
                  <span className="btn-text">{t('history.step1Button')}</span>
                </button>
                <button className="modal-btn btn-simulation" onClick={goToSimulation}>
                  <span className="btn-step">Step2</span>
                  <span className="btn-icon">◈</span>
                  <span className="btn-text">{t('history.step2Button')}</span>
                </button>
                <button className="modal-btn btn-report" onClick={goToReport} disabled={!selectedProject.report_id}>
                  <span className="btn-step">Step4</span>
                  <span className="btn-icon">◆</span>
                  <span className="btn-text">{t('history.step4Button')}</span>
                </button>
              </div>
              <div className="modal-playback-hint">
                <span className="hint-text">{t('history.replayHint')}</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default HistoryDatabase;
