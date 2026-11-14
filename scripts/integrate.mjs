/**
 * Merges agent-produced feature modules into the repo and regenerates the registry.
 * - rewrites `Hono` router params to the typed FeatureHono
 * - derives slug from the directory and permissions from the route guards
 * - writes src/features/index.ts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = {
  1: 'Tournament Registration & Scheduling', 2: 'Tournament Attendance & No-Show Management',
  3: 'Tournament Formats & Blocked Mode', 4: 'Match Experience & Result Management',
  5: 'Chess Arena & Game Modes', 6: 'Player Profiles, Ratings & Leaderboards',
  7: 'Chess Game Analysis & PGN Management', 8: 'Rankings, Championships & Seasonal Awards',
  9: 'Chess Academy', 10: 'Chess Coaching & Mentorship',
  11: 'Chess Community & Social Interaction', 12: 'Club Membership & Student Community',
  13: 'Achievements, Certificates & Recognition', 14: 'Volunteer & Participation Management',
  15: 'Alumni & Legacy Network', 16: 'Club Events & Activities',
  17: 'Calendar & Academic Year Management', 18: 'Digital Notice Board & Announcement Management',
  19: 'Executive Committee, Elections & Leadership Transition', 20: 'Club Finance & Fund Management',
  21: 'Equipment & Inventory Management', 22: 'Transport & Travel Management',
  23: 'Facility, Venue & Infrastructure Management', 24: 'Sponsorship, Partnerships & University Relations',
  25: 'Inter-University Competition & Federation Management', 26: 'Public Website & Club Branding',
  27: 'Marketing, Public Relations & Digital Outreach', 28: 'Media, Gallery & Digital Archive',
  29: 'Search & Discovery', 30: 'Feedback, Complaints & Support',
  31: 'Surveys, Polls & Community Decision-Making', 32: 'Website Experience Improvement Centre',
  33: 'Knowledge Base & Resource Centre', 34: 'Accessibility & Inclusivity',
  35: 'Live Match Commentary', 36: 'Privacy, Security & Account Protection',
  37: 'Digital Services & External Integrations', 38: 'Data Management, Backup & Recovery',
  39: 'System Administration & Platform Control', 40: 'Performance, Reliability & Quality Assurance',
  41: 'Legal Compliance, Privacy Governance & Data Protection', 42: 'Cybersecurity & Security Operations',
  43: 'Disaster Recovery & Emergency Operations', 44: 'Artificial Intelligence & Intelligent Assistance',
  45: 'Unified Institutional Performance & Reporting', 46: 'Club Strategy & Development Planning',
  47: 'Centralized Operational Task Coordination', 48: 'Critical Alerts & Emergency Escalation',
  49: 'Academic-Year Institutional Command View', 50: 'Unified Command Centre & Institutional Operations Hub',
};

const SLUG_OVERRIDE = { 1: 'tournaments' };
const SRC = process.argv[2] || '/scratch/input';
const DEST = 'src/features';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1) copy every incoming feature dir + test file
const incoming = walk(SRC).filter((f) => /\/(src\/features|test)\//.test(f) || f.includes('/src/features/'));
for (const f of incoming) {
  const rel = f.slice(SRC.length + 1);
  if (!/^src\/features\/|^test\//.test(rel)) continue;
  if (rel === 'src/features/index.ts') continue;
  const target = join('.', rel);
  mkdirSync(join(target, '..'), { recursive: true });
  cpSync(f, target);
}

// 2) normalise router typing
const modules = [];
for (const dir of readdirSync(DEST, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const m = dir.name.match(/^f(\d{2})-(.+)$/);
  if (!m) continue;
  const id = Number(m[1]);
  const slug = SLUG_OVERRIDE[id] || m[2];
  const routesPath = join(DEST, dir.name, 'routes.ts');
  if (!existsSync(routesPath)) continue;
  let code = readFileSync(routesPath, 'utf8');
  if (code.includes("from 'hono'") && !code.includes('FeatureHono')) {
    code = code.replace(/import\s+type\s*\{\s*Hono\s*\}\s*from\s*'hono';?/, "import type { FeatureHono, FeatureContext } from '../../core/types.js';");
    code = code.replace(/import\s+type\s*\{\s*FeatureContext\s*\}\s*from\s*'\.\.\/\.\.\/core\/types\.js';?\n?/g, '');
  }
  code = code.replace(/app:\s*Hono\b/g, 'app: FeatureHono');
  writeFileSync(routesPath, code);

  // the frozen Repo is non-generic: strip any `repo.method<Row>(...)` type arguments
  code = code.replace(/\.(find|findOne|get|insert|update|remove|count)<[A-Za-z_][\w.]*>\(/g, '.$1(');
  writeFileSync(routesPath, code);

  for (const svc of ['service.ts']) {
    const sp = join(DEST, dir.name, svc);
    if (!existsSync(sp)) continue;
    const sc = readFileSync(sp, 'utf8');
    const cleaned = sc.replace(/\.(find|findOne|get|insert|update|remove|count)<[A-Za-z_][\w.]*>\(/g, '.$1(');
    if (cleaned !== sc) writeFileSync(sp, cleaned);
  }

  const perms = [...new Set([...code.matchAll(/requirePermission\(([^)]*)\)/g)]
    .flatMap((x) => [...x[1].matchAll(/'([^']+)'/g)].map((y) => y[1])))];
  modules.push({ id, slug, name: NAMES[id] || slug, perms });
}

modules.sort((a, b) => a.id - b.id);

const imports = modules.map((m) => `import { mount as f${m.id} } from './${dirOf(m)}/routes.js';`).join('\n');
const entries = modules.map((m) => `  {
    id: ${m.id},
    slug: '${m.slug}',
    name: ${JSON.stringify(m.name)},
    permissions: ${JSON.stringify(m.perms)},
    mount: f${m.id},
  },`).join('\n');

function dirOf(m) {
  return readdirSync(DEST).find((d) => d.startsWith(`f${String(m.id).padStart(2, '0')}-`));
}

writeFileSync(join(DEST, 'index.ts'), `import type { FeatureModule } from '../core/types.js';
${imports}

/**
 * Feature registry — doc 11-20. Every module is mounted at /api/v1/<slug>.
 * Exactly 50 features; the catalogue is fixed by the specification.
 */
export const FEATURES: FeatureModule[] = [
${entries}
];
`);

console.log(`registry: ${modules.length} features`);
console.log(modules.map((m) => `${String(m.id).padStart(2, '0')} ${m.slug}`).join('\n'));
