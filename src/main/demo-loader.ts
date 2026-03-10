import demoData from './demo-data.json';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { Project, Job, AppSettings } from '../shared/types';

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

export function getDemoProjects(): Project[] {
  return demoData.projects as Project[];
}

export function getDemoJobs(): Job[] {
  const now = Date.now();

  return demoData.jobs.map((raw) => {
    const job = { ...raw } as Record<string, unknown>;

    // Convert relative time offsets to absolute timestamps
    if (typeof job._planningStartedAgoMs === 'number') {
      job.planningStartedAt = new Date(now - (job._planningStartedAgoMs as number)).toISOString();
      delete job._planningStartedAgoMs;
    }
    if (typeof job._developmentStartedAgoMs === 'number') {
      job.developmentStartedAt = new Date(now - (job._developmentStartedAgoMs as number)).toISOString();
      delete job._developmentStartedAgoMs;
    }

    // Ensure required arrays exist
    if (!job.outputLog) job.outputLog = [];
    if (!job.rawMessages) job.rawMessages = [];

    return job as unknown as Job;
  });
}

interface BranchStatus {
  name: string;
  isCurrent: boolean;
  ahead: number;
  dirtyFiles: number;
}

const demoBranchStatuses: Record<string, BranchStatus[]> = {
  'demo-proj-agents-kb': [
    { name: 'dev', isCurrent: true, ahead: 2, dirtyFiles: 4 },
    { name: 'main', isCurrent: false, ahead: 0, dirtyFiles: 0 },
  ],
  'demo-proj-billing-api': [
    { name: 'main', isCurrent: true, ahead: 1, dirtyFiles: 3 },
    { name: 'dev', isCurrent: false, ahead: 0, dirtyFiles: 0 },
  ],
  'demo-proj-marketing-site': [
    { name: 'dev', isCurrent: true, ahead: 0, dirtyFiles: 7 },
    { name: 'main', isCurrent: false, ahead: 0, dirtyFiles: 0 },
  ],
  'demo-proj-ml-pipeline': [
    { name: 'main', isCurrent: true, ahead: 0, dirtyFiles: 2 },
  ],
};

export function getDemoBranchStatuses(projectId: string): BranchStatus[] | null {
  return demoBranchStatuses[projectId] ?? null;
}

export function getDemoSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    alwaysShowModelEffort: true,
    showTokenUsage: true,
  };
}
