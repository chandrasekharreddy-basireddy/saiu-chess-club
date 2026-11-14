import type { FeatureModule } from '../core/types.js';
import { mount as f1 } from './f01-tournament-registration/routes.js';
import { mount as f2 } from './f02-attendance/routes.js';
import { mount as f3 } from './f03-formats/routes.js';
import { mount as f4 } from './f04-match-room/routes.js';
import { mount as f5 } from './f05-arena/routes.js';
import { mount as f6 } from './f06-ratings/routes.js';
import { mount as f7 } from './f07-analysis/routes.js';
import { mount as f8 } from './f08-rankings/routes.js';
import { mount as f9 } from './f09-academy/routes.js';
import { mount as f10 } from './f10-coaching/routes.js';
import { mount as f11 } from './f11-community/routes.js';
import { mount as f12 } from './f12-membership/routes.js';
import { mount as f13 } from './f13-achievements/routes.js';
import { mount as f14 } from './f14-volunteers/routes.js';
import { mount as f15 } from './f15-alumni/routes.js';
import { mount as f16 } from './f16-events/routes.js';
import { mount as f17 } from './f17-calendar/routes.js';
import { mount as f18 } from './f18-notices/routes.js';
import { mount as f19 } from './f19-governance/routes.js';
import { mount as f20 } from './f20-finance/routes.js';
import { mount as f21 } from './f21-inventory/routes.js';
import { mount as f22 } from './f22-travel/routes.js';
import { mount as f23 } from './f23-facilities/routes.js';
import { mount as f24 } from './f24-sponsorships/routes.js';
import { mount as f25 } from './f25-interuniversity/routes.js';
import { mount as f26 } from './f26-site/routes.js';
import { mount as f27 } from './f27-marketing/routes.js';
import { mount as f28 } from './f28-media/routes.js';
import { mount as f29 } from './f29-search/routes.js';
import { mount as f30 } from './f30-support/routes.js';
import { mount as f31 } from './f31-surveys/routes.js';
import { mount as f32 } from './f32-experience/routes.js';
import { mount as f33 } from './f33-knowledge-base/routes.js';
import { mount as f34 } from './f34-accessibility/routes.js';
import { mount as f35 } from './f35-commentary/routes.js';
import { mount as f36 } from './f36-security/routes.js';
import { mount as f37 } from './f37-integrations/routes.js';
import { mount as f38 } from './f38-data-management/routes.js';
import { mount as f39 } from './f39-administration/routes.js';
import { mount as f40 } from './f40-quality/routes.js';
import { mount as f41 } from './f41-compliance/routes.js';
import { mount as f42 } from './f42-cyberops/routes.js';
import { mount as f43 } from './f43-recovery/routes.js';
import { mount as f44 } from './f44-ai/routes.js';
import { mount as f45 } from './f45-reporting/routes.js';
import { mount as f46 } from './f46-strategy/routes.js';
import { mount as f47 } from './f47-tasks/routes.js';
import { mount as f48 } from './f48-alerts/routes.js';
import { mount as f49 } from './f49-academic-year/routes.js';
import { mount as f50 } from './f50-command-centre/routes.js';

/**
 * Feature registry — doc 11-20. Every module is mounted at /api/v1/<slug>.
 * Exactly 50 features; the catalogue is fixed by the specification.
 */
export const FEATURES: FeatureModule[] = [
  {
    id: 1,
    slug: 'tournaments',
    name: "Tournament Registration & Scheduling",
    permissions: ["tournament.create","tournament.manage","tournament.registration.manage","tournament.schedule.propose"],
    mount: f1,
  },
  {
    id: 2,
    slug: 'attendance',
    name: "Tournament Attendance & No-Show Management",
    permissions: ["tournament.manage","match.result.manage"],
    mount: f2,
  },
  {
    id: 3,
    slug: 'formats',
    name: "Tournament Formats & Blocked Mode",
    permissions: [],
    mount: f3,
  },
  {
    id: 4,
    slug: 'match-room',
    name: "Match Experience & Result Management",
    permissions: ["arena.spectate"],
    mount: f4,
  },
  {
    id: 5,
    slug: 'arena',
    name: "Chess Arena & Game Modes",
    permissions: ["arena.play","tournament.manage","match.result.manage"],
    mount: f5,
  },
  {
    id: 6,
    slug: 'ratings',
    name: "Player Profiles, Ratings & Leaderboards",
    permissions: ["rating.recalculate","audit.log.read","match.dispute.resolve_assigned"],
    mount: f6,
  },
  {
    id: 7,
    slug: 'analysis',
    name: "Chess Game Analysis & PGN Management",
    permissions: ["analysis.read","analysis.run"],
    mount: f7,
  },
  {
    id: 8,
    slug: 'rankings',
    name: "Rankings, Championships & Seasonal Awards",
    permissions: ["tournament.manage","match.result.manage","rating.recalculate","reporting.read","achievement.issue"],
    mount: f8,
  },
  {
    id: 9,
    slug: 'academy',
    name: "Chess Academy",
    permissions: ["academy.content.publish"],
    mount: f9,
  },
  {
    id: 10,
    slug: 'coaching',
    name: "Chess Coaching & Mentorship",
    permissions: ["coaching.assignment.manage","tournament.manage"],
    mount: f10,
  },
  {
    id: 11,
    slug: 'community',
    name: "Chess Community & Social Interaction",
    permissions: ["community.post","community.moderate"],
    mount: f11,
  },
  {
    id: 12,
    slug: 'membership',
    name: "Club Membership & Student Community",
    permissions: ["membership.manage","membership.approve"],
    mount: f12,
  },
  {
    id: 13,
    slug: 'achievements',
    name: "Achievements, Certificates & Recognition",
    permissions: ["achievement.issue"],
    mount: f13,
  },
  {
    id: 14,
    slug: 'volunteers',
    name: "Volunteer & Participation Management",
    permissions: ["volunteer.manage"],
    mount: f14,
  },
  {
    id: 15,
    slug: 'alumni',
    name: "Alumni & Legacy Network",
    permissions: ["alumni.manage"],
    mount: f15,
  },
  {
    id: 16,
    slug: 'events',
    name: "Club Events & Activities",
    permissions: ["event.manage"],
    mount: f16,
  },
  {
    id: 17,
    slug: 'calendar',
    name: "Calendar & Academic Year Management",
    permissions: ["calendar.manage"],
    mount: f17,
  },
  {
    id: 18,
    slug: 'notices',
    name: "Digital Notice Board & Announcement Management",
    permissions: ["notice.publish"],
    mount: f18,
  },
  {
    id: 19,
    slug: 'governance',
    name: "Executive Committee, Elections & Leadership Transition",
    permissions: ["governance.policy.manage","governance.election.manage"],
    mount: f19,
  },
  {
    id: 20,
    slug: 'finance',
    name: "Club Finance & Fund Management",
    permissions: ["finance.read","finance.expense.approve"],
    mount: f20,
  },
  {
    id: 21,
    slug: 'inventory',
    name: "Equipment & Inventory Management",
    permissions: ["inventory.manage","finance.read","finance.expense.approve"],
    mount: f21,
  },
  {
    id: 22,
    slug: 'travel',
    name: "Transport & Travel Management",
    permissions: ["travel.manage"],
    mount: f22,
  },
  {
    id: 23,
    slug: 'facilities',
    name: "Facility, Venue & Infrastructure Management",
    permissions: ["facility.booking.approve","reporting.read","facility.booking"],
    mount: f23,
  },
  {
    id: 24,
    slug: 'sponsorships',
    name: "Sponsorship, Partnerships & University Relations",
    permissions: ["sponsorship.manage","finance.read"],
    mount: f24,
  },
  {
    id: 25,
    slug: 'interuniversity',
    name: "Inter-University Competition & Federation Management",
    permissions: ["interuniversity.manage"],
    mount: f25,
  },
  {
    id: 26,
    slug: 'site',
    name: "Public Website & Club Branding",
    permissions: [],
    mount: f26,
  },
  {
    id: 27,
    slug: 'marketing',
    name: "Marketing, Public Relations & Digital Outreach",
    permissions: [],
    mount: f27,
  },
  {
    id: 28,
    slug: 'media',
    name: "Media, Gallery & Digital Archive",
    permissions: [],
    mount: f28,
  },
  {
    id: 29,
    slug: 'search',
    name: "Search & Discovery",
    permissions: ["audit.log.read","system.configuration.manage"],
    mount: f29,
  },
  {
    id: 30,
    slug: 'support',
    name: "Feedback, Complaints & Support",
    permissions: [],
    mount: f30,
  },
  {
    id: 31,
    slug: 'surveys',
    name: "Surveys, Polls & Community Decision-Making",
    permissions: ["survey.create","survey.respond","community.post"],
    mount: f31,
  },
  {
    id: 32,
    slug: 'experience',
    name: "Website Experience Improvement Centre",
    permissions: ["feedback.submit","site.experience.manage"],
    mount: f32,
  },
  {
    id: 33,
    slug: 'knowledge-base',
    name: "Knowledge Base & Resource Centre",
    permissions: ["kb.publish"],
    mount: f33,
  },
  {
    id: 34,
    slug: 'accessibility',
    name: "Accessibility & Inclusivity",
    permissions: ["accessibility.manage"],
    mount: f34,
  },
  {
    id: 35,
    slug: 'commentary',
    name: "Live Match Commentary",
    permissions: ["commentary.publish","tournament.manage","community.moderate"],
    mount: f35,
  },
  {
    id: 36,
    slug: 'security',
    name: "Privacy, Security & Account Protection",
    permissions: ["privacy.request.handle","security.role.assign","security.operations.manage","audit.log.read"],
    mount: f36,
  },
  {
    id: 37,
    slug: 'integrations',
    name: "Digital Services & External Integrations",
    permissions: ["system.configuration.manage","ai.manage"],
    mount: f37,
  },
  {
    id: 38,
    slug: 'data-management',
    name: "Data Management, Backup & Recovery",
    permissions: ["data.backup.manage","disaster.recovery.manage","data.export.request"],
    mount: f38,
  },
  {
    id: 39,
    slug: 'administration',
    name: "System Administration & Platform Control",
    permissions: ["system.configuration.manage","audit.log.read"],
    mount: f39,
  },
  {
    id: 40,
    slug: 'quality',
    name: "Performance, Reliability & Quality Assurance",
    permissions: ["qa.manage","reporting.read"],
    mount: f40,
  },
  {
    id: 41,
    slug: 'compliance',
    name: "Legal Compliance, Privacy Governance & Data Protection",
    permissions: ["legal.compliance.manage","governance.policy.manage","privacy.request.handle"],
    mount: f41,
  },
  {
    id: 42,
    slug: 'cyberops',
    name: "Cybersecurity & Security Operations",
    permissions: ["security.operations.manage"],
    mount: f42,
  },
  {
    id: 43,
    slug: 'recovery',
    name: "Disaster Recovery & Emergency Operations",
    permissions: ["disaster.recovery.manage","command.view","tournament.manage"],
    mount: f43,
  },
  {
    id: 44,
    slug: 'ai',
    name: "Artificial Intelligence & Intelligent Assistance",
    permissions: ["ai.use","ai.manage"],
    mount: f44,
  },
  {
    id: 45,
    slug: 'reporting',
    name: "Unified Institutional Performance & Reporting",
    permissions: ["reporting.read","finance.read"],
    mount: f45,
  },
  {
    id: 46,
    slug: 'strategy',
    name: "Club Strategy & Development Planning",
    permissions: ["strategy.manage"],
    mount: f46,
  },
  {
    id: 47,
    slug: 'tasks',
    name: "Centralized Operational Task Coordination",
    permissions: ["task.manage"],
    mount: f47,
  },
  {
    id: 48,
    slug: 'alerts',
    name: "Critical Alerts & Emergency Escalation",
    permissions: ["alert.broadcast"],
    mount: f48,
  },
  {
    id: 49,
    slug: 'academic-year',
    name: "Academic-Year Institutional Command View",
    permissions: ["reporting.read","command.view","strategy.manage"],
    mount: f49,
  },
  {
    id: 50,
    slug: 'command-centre',
    name: "Unified Command Centre & Institutional Operations Hub",
    permissions: ["command.view"],
    mount: f50,
  },
];
