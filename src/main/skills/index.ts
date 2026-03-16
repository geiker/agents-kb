import fs from 'fs';
import path from 'path';
import os from 'os';
import { ipcMain } from 'electron';
import type { Skill } from '../../shared/types';

const SKILL_FILENAME = 'SKILL.md';

// In-memory cache of skills reported by running sessions (keyed by project path)
const skillsCache = new Map<string, Skill[]>();

export function setSkillsCache(projectPath: string, skills: Skill[]): void {
  skillsCache.set(projectPath, skills);
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && val) fields[key] = val;
  }
  return fields;
}

function readSkillsFromDir(dir: string, source: Skill['source']): Skill[] {
  if (!fs.existsSync(dir)) return [];

  const skills: Skill[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillFile = path.join(dir, entry, SKILL_FILENAME);
    try {
      const stat = fs.statSync(path.join(dir, entry));
      if (!stat.isDirectory()) continue;

      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf-8');
      const fm = parseFrontmatter(content);

      skills.push({
        name: fm.name || entry,
        description: fm.description || '',
        source,
        filePath: skillFile,
      });
    } catch {
      // Skip unreadable entries
    }
  }

  return skills;
}

export function listSkills(projectPath?: string): Skill[] {
  const globalDir = path.join(os.homedir(), '.claude', 'skills');
  const globalSkills = readSkillsFromDir(globalDir, 'global');

  let projectSkills: Skill[] = [];
  if (projectPath) {
    const projectDir = path.join(projectPath, '.claude', 'skills');
    projectSkills = readSkillsFromDir(projectDir, 'project');
  }

  // Merge: SDK-cached skills first, then filesystem (project, global)
  const cached = projectPath ? skillsCache.get(projectPath) ?? [] : [];
  return [...cached, ...projectSkills, ...globalSkills];
}

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:list', (_event, projectId?: string) => {
    return listSkills(projectId);
  });
}
