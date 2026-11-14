import type { AuditEvent, AuditSink, FeatureContext } from './types.js';

/** Durable audit sink: append-only rows in the `audit_log` table (doc 03 §14). */
export function repoAuditSink(ctx: Pick<FeatureContext, 'repo' | 'now' | 'newId'>): AuditSink {
  return {
    async record(e: AuditEvent) {
      await ctx.repo.insert('audit_log', {
        id: ctx.newId(),
        action: e.action,
        actorId: e.actorId ?? null,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        detail: e.detail ?? null,
        at: ctx.now(),
      });
    },
  };
}

export class MemoryAudit implements AuditSink {
  events: AuditEvent[] = [];
  async record(e: AuditEvent) { this.events.push(e); }
}
