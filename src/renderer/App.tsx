import { useEffect, useCallback } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';
import { useShortcut } from './hooks/useShortcut';
import { KanbanBoard } from './components/KanbanBoard';
import { ProjectManager } from './components/ProjectManager';
import { JobDetailPanel } from './components/JobDetailPanel';
import { NewJobDialog } from './components/NewJobDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Kbd } from './components/Kbd';

function applyDarkClass(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark);
}

export default function App() {
  const init = useKanbanStore((s) => s.init);
  const selectedJobId = useKanbanStore((s) => s.selectedJobId);
  const showNewJobDialog = useKanbanStore((s) => s.showNewJobDialog);
  const setShowNewJobDialog = useKanbanStore((s) => s.setShowNewJobDialog);
  const showSettings = useKanbanStore((s) => s.showSettings);
  const setShowSettings = useKanbanStore((s) => s.setShowSettings);
  const projects = useKanbanStore((s) => s.projects);
  const theme = useKanbanStore((s) => s.settings.theme);

  useEffect(() => {
    init().catch((err) => console.error('[App] init failed:', err));
  }, [init]);

  // Sync dark class with actual resolved theme from main process
  useEffect(() => {
    const api = window.electronAPI;
    // Get initial actual theme
    api.themeGetActual().then((actual) => applyDarkClass(actual === 'dark'));
    // Listen for changes (system theme change or user toggle)
    return api.onThemeChanged((actual) => applyDarkClass(actual === 'dark'));
  }, [theme]);

  const toggleNewJob = useCallback(() => {
    if (projects.length > 0) setShowNewJobDialog(!showNewJobDialog);
  }, [projects.length, setShowNewJobDialog, showNewJobDialog]);

  useShortcut('newJob', toggleNewJob, { enabled: projects.length > 0 });

  const toggleSettings = useCallback(() => setShowSettings(!showSettings), [setShowSettings, showSettings]);
  useShortcut('openSettings', toggleSettings);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <ProjectManager />

      {/* Main board area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Drag region / title bar */}
        <div
          className="h-12 flex items-center justify-between px-4 shrink-0 border-b border-chrome-subtle/70"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <h1 className="text-sm font-semibold tracking-wide text-content-tertiary uppercase">
            Agent Kanban
          </h1>
          <button
            onClick={() => setShowNewJobDialog(true)}
            disabled={projects.length === 0}
            className="text-sm px-4 py-1.5 rounded-md bg-btn-primary text-content-inverted font-medium hover:bg-btn-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            + New Job<Kbd shortcutId="newJob" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <KanbanBoard />
          {selectedJobId && <JobDetailPanel />}
        </div>
      </div>

      {/* Modals */}
      {showNewJobDialog && <NewJobDialog />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}
