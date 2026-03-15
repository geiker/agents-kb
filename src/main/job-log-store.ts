import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { OutputEntry, RawMessage } from '../shared/types';

type JobLogRecord =
  | { type: 'output'; entry: OutputEntry }
  | { type: 'raw'; message: RawMessage };

const JOB_LOG_DIR = 'job-logs';
const FLUSH_DELAY_MS = 250;

const pendingWrites = new Map<string, string[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function getJobLogDir(): string {
  const dir = path.join(app.getPath('userData'), JOB_LOG_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getJobLogPath(jobId: string): string {
  return path.join(getJobLogDir(), `${jobId}.jsonl`);
}

function encodeRecord(record: JobLogRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPendingWrites();
  }, FLUSH_DELAY_MS);
}

function flushPendingWrites(): void {
  if (process.env.DEMO_MODE === 'true') {
    pendingWrites.clear();
    return;
  }

  for (const [jobId, lines] of pendingWrites) {
    if (lines.length === 0) continue;
    fs.appendFileSync(getJobLogPath(jobId), lines.join(''), 'utf-8');
  }

  pendingWrites.clear();
}

function queueWrite(jobId: string, record: JobLogRecord): void {
  if (process.env.DEMO_MODE === 'true') return;

  const lines = pendingWrites.get(jobId) || [];
  lines.push(encodeRecord(record));
  pendingWrites.set(jobId, lines);
  scheduleFlush();
}

export function appendOutputRecord(jobId: string, entry: OutputEntry): void {
  queueWrite(jobId, { type: 'output', entry });
}

export function appendRawRecord(jobId: string, message: RawMessage): void {
  queueWrite(jobId, { type: 'raw', message });
}

export function replaceJobLogs(jobId: string, outputLog: OutputEntry[], rawMessages: RawMessage[]): void {
  pendingWrites.delete(jobId);

  if (process.env.DEMO_MODE === 'true') return;

  const filePath = getJobLogPath(jobId);
  const lines = [
    ...outputLog.map((entry) => encodeRecord({ type: 'output', entry })),
    ...rawMessages.map((message) => encodeRecord({ type: 'raw', message })),
  ];

  if (lines.length === 0) {
    fs.rmSync(filePath, { force: true });
    return;
  }

  fs.writeFileSync(filePath, lines.join(''), 'utf-8');
}

export function loadJobLogs(jobId: string): { outputEntries: OutputEntry[]; rawMessages: RawMessage[] } {
  if (process.env.DEMO_MODE === 'true') {
    return { outputEntries: [], rawMessages: [] };
  }

  const filePath = getJobLogPath(jobId);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const outputEntries: OutputEntry[] = [];
    const rawMessages: RawMessage[] = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed) as JobLogRecord;
        if (record.type === 'output') {
          outputEntries.push(record.entry);
        } else if (record.type === 'raw') {
          rawMessages.push(record.message);
        }
      } catch {
        // Ignore malformed trailing or legacy lines and continue loading what we can.
      }
    }

    return { outputEntries, rawMessages };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { outputEntries: [], rawMessages: [] };
    }
    throw error;
  }
}

export function deleteJobLogs(jobId: string): void {
  pendingWrites.delete(jobId);

  if (process.env.DEMO_MODE === 'true') return;

  fs.rmSync(getJobLogPath(jobId), { force: true });
}

export function flushJobLogsNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushPendingWrites();
}
