import type { Hono } from 'hono';

export type Role =
  | 'president' | 'administrator' | 'organizer' | 'coach'
  | 'committee' | 'member' | 'alumnus' | 'spectator';

export interface Session {
  userId: string;
  roles: Role[];
  permissions: string[];
  /** account state gate: only 'active' accounts may act */
  state?: string;
}

export type Row = Record<string, any>;

export interface ListOpts {
  limit?: number;
  offset?: number;
  orderBy?: string;
  desc?: boolean;
}

/** Generic persistence contract. Every feature reads/writes through this. */
export interface Repo {
  insert(table: string, row: Row): Promise<Row>;
  get(table: string, id: string): Promise<Row | null>;
  find(table: string, filter?: Row, opts?: ListOpts): Promise<Row[]>;
  findOne(table: string, filter?: Row): Promise<Row | null>;
  update(table: string, id: string, patch: Row): Promise<Row | null>;
  remove(table: string, id: string): Promise<boolean>;
  count(table: string, filter?: Row): Promise<number>;
}

export interface AuditEvent {
  action: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  detail?: any;
}

export interface AuditSink {
  record(e: AuditEvent): Promise<void>;
}

export interface FeatureContext {
  repo: Repo;
  audit: AuditSink;
  now(): string;
  newId(): string;
}

export type FeatureHono = Hono<{ Variables: { session: any; parsedBody: any } }>;

export interface FeatureModule {
  id: number;
  slug: string;
  name: string;
  /** permission keys this feature enforces */
  permissions: string[];
  /** mount routes; the app is mounted at /api/v1/<slug> */
  mount(app: FeatureHono, ctx: FeatureContext): void;
}
