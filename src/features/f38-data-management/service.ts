import type { FeatureContext, Session, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { hasPermission, assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 38 — Data Management, Backup & Recovery
 *
 * Tables
 *  - data_backup_jobs        backup job records: status, checksum, size, encryption,
 *                            integrity-verification and restore-verification flags
 *  - data_restore_requests   restore requests + independent approval + execution marker
 *  - data_export_requests    permission-checked, audited exports
 *  - data_import_batches     CSV/Excel import preview → confirm → commit batches
 *
 * Rules encoded here: a backup is not valid until integrity *and* restore checks pass; restores
 * need a second human; sensitive exports need an elevated permission; imports can never silently
 * overwrite authoritative records (preview + explicit confirmation required).
 */

export const BACKUPS = 'data_backup_jobs';
export const RESTORES = 'data_restore_requests';
export const EXPORTS = 'data_export_requests';
export const IMPORTS = 'data_import_batches';

export const BACKUP_STATUSES = ['queued', 'running', 'completed', 'failed'];
export const EXPORT_SCOPES = ['members', 'tournaments', 'attendance', 'finance', 'reports', 'all'];

/** Import targets map onto authoritative tables; the key field detects duplicates. */
export const IMPORT_TARGETS: Record<string, { table: string; keyField: string }> = {
  members: { table: 'users', keyField: 'email' },
  tournaments: { table: 'tournaments', keyField: 'name' },
  attendance: { table: 'attendance_records', keyField: 'memberId' },
};

const MAX_IMPORT_ROWS = 500;

function backupView(row: Row) {
  const integrityVerified = !!row.integrityVerified;
  const restoreVerified = !!row.restoreVerified;
  return {
    ...row,
    valid: row.status === 'completed' && integrityVerified && restoreVerified,
  };
}

/* ----------------------------------------------------------------- backups */

export async function createBackupJob(ctx: FeatureContext, actorId: string, input: any = {}) {
  const scope = input.scope || 'full';
  if (!['full', 'members', 'tournaments', 'finance'].includes(scope)) {
    throw badRequest('scope must be one of full, members, tournaments, finance');
  }
  const row = await ctx.repo.insert(BACKUPS, {
    id: ctx.newId(),
    scope,
    target: input.target || 'supabase_free_export',
    // Supabase free tier has no managed PITR: this job is the explicit, tested process.
    process: 'scheduled logical export + off-platform copy',
    status: 'queued',
    checksum: null,
    sizeBytes: null,
    encrypted: null,
    storageRef: null,
    integrityVerified: false,
    integrityVerifiedAt: null,
    restoreVerified: false,
    restoreVerifiedAt: null,
    valid: false,
    failureReason: null,
    note: input.note ?? null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'data.backup.create', actorId, targetType: 'backup', targetId: row.id, detail: { scope } });
  return backupView(row);
}

export async function completeBackupJob(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(BACKUPS, id);
  if (!row) throw notFound('Backup job not found');
  if (row.status === 'completed') throw conflict('Backup job is already completed');
  if (row.status === 'failed') throw conflict('Backup job has failed; start a new job');

  const checksum = typeof input.checksum === 'string' ? input.checksum.trim() : '';
  if (checksum.length < 16) throw badRequest('checksum is required (at least 16 characters)');
  const sizeBytes = Number(input.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw badRequest('sizeBytes must be a positive number');
  if (input.encrypted === false) throw badRequest('Backups must be encrypted');

  const updated = await ctx.repo.update(BACKUPS, id, {
    status: 'completed',
    checksum,
    sizeBytes,
    encrypted: true,
    storageRef: input.storageRef || null,
    completedAt: ctx.now(),
    integrityVerified: false,
    restoreVerified: false,
  });
  await ctx.audit.record({
    action: 'data.backup.complete',
    actorId,
    targetType: 'backup',
    targetId: id,
    detail: { sizeBytes, checksum },
  });
  return backupView(updated as Row);
}

export async function failBackupJob(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(BACKUPS, id);
  if (!row) throw notFound('Backup job not found');
  if (row.status === 'completed') throw conflict('A completed backup cannot be marked failed');
  const updated = await ctx.repo.update(BACKUPS, id, {
    status: 'failed',
    failureReason: input.reason || 'unspecified failure',
    completedAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'data.backup.fail', actorId, targetType: 'backup', targetId: id, detail: { reason: input.reason ?? null } });
  return backupView(updated as Row);
}

/** Integrity check: the supplied checksum must match the recorded one. */
export async function verifyBackupIntegrity(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(BACKUPS, id);
  if (!row) throw notFound('Backup job not found');
  if (row.status !== 'completed') throw conflict('Only a completed backup can be integrity-verified');
  const checksum = typeof input.checksum === 'string' ? input.checksum.trim() : '';
  if (!checksum) throw badRequest('checksum is required for verification');
  if (checksum !== row.checksum) {
    throw unprocessable('Checksum mismatch: the backup artifact does not match the recorded checksum');
  }
  const updated = await ctx.repo.update(BACKUPS, id, {
    integrityVerified: true,
    integrityVerifiedAt: ctx.now(),
    integrityVerifiedBy: actorId,
  });
  await ctx.audit.record({ action: 'data.backup.verify', actorId, targetType: 'backup', targetId: id });
  return backupView(updated as Row);
}

/** Periodic restore test: a backup is only valid once a restore has actually been rehearsed. */
export async function verifyBackupRestore(ctx: FeatureContext, actorId: string, id: string, input: any = {}) {
  const row = await ctx.repo.get(BACKUPS, id);
  if (!row) throw notFound('Backup job not found');
  if (row.status !== 'completed') throw conflict('Only a completed backup can be restore-verified');
  if (!row.integrityVerified) throw conflict('Integrity verification must pass before a restore test');
  const updated = await ctx.repo.update(BACKUPS, id, {
    restoreVerified: true,
    restoreVerifiedAt: ctx.now(),
    restoreVerifiedBy: actorId,
    restoreEnvironment: input.environment || 'staging',
  });
  await ctx.audit.record({
    action: 'data.backup.restore_verify',
    actorId,
    targetType: 'backup',
    targetId: id,
    detail: { environment: input.environment || 'staging' },
  });
  return backupView(updated as Row);
}

export async function listBackups(ctx: FeatureContext, filter: { status?: string } = {}) {
  const rows = await ctx.repo.find(BACKUPS, filter.status ? { status: filter.status } : {}, { orderBy: 'createdAt', desc: true });
  return rows.map(backupView);
}

export async function getBackup(ctx: FeatureContext, id: string) {
  const row = await ctx.repo.get(BACKUPS, id);
  if (!row) throw notFound('Backup job not found');
  return backupView(row);
}

/* ---------------------------------------------------------------- restores */

export async function createRestoreRequest(ctx: FeatureContext, actorId: string, input: any = {}) {
  const backupId = input.backupId;
  if (!backupId) throw badRequest('backupId is required');
  const backup = await ctx.repo.get(BACKUPS, backupId);
  if (!backup) throw notFound('Backup not found');
  if (backup.status !== 'completed') throw conflict('Backup has not completed');
  if (!backup.integrityVerified || !backup.restoreVerified) {
    throw conflict('Backup must pass integrity and restore verification before it can be restored');
  }
  const row = await ctx.repo.insert(RESTORES, {
    id: ctx.newId(),
    backupId,
    reason: input.reason ?? null,
    requestedBy: actorId,
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    idempotencyKey: `restore:${backupId}`,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({ action: 'data.restore.request', actorId, targetType: 'restore', targetId: row.id, detail: { backupId } });
  return row;
}

export async function approveRestoreRequest(ctx: FeatureContext, session: Session, id: string, input: any = {}) {
  const row = await ctx.repo.get(RESTORES, id);
  if (!row) throw notFound('Restore request not found');
  if (row.status !== 'pending') throw conflict(`Restore request is already ${row.status}`);
  if (!hasPermission(session, 'disaster.recovery.manage') && !hasPermission(session, 'data.backup.manage')) {
    throw forbidden('Requires permission: disaster.recovery.manage');
  }
  try {
    assertNotSelfApproval(session.userId, row.requestedBy, 'a restore request');
  } catch {
    throw forbidden('Separation of duties: the requester cannot approve their own restore');
  }
  const updated = await ctx.repo.update(RESTORES, id, {
    status: 'approved',
    approvedBy: session.userId,
    approvedAt: ctx.now(),
    approvalNote: input.note ?? null,
  });
  await ctx.audit.record({ action: 'data.restore.approve', actorId: session.userId, targetType: 'restore', targetId: id, detail: { backupId: row.backupId } });
  return updated;
}

/** Execution is idempotent: recovery must not create duplicate notifications or financial actions. */
export async function executeRestoreRequest(ctx: FeatureContext, session: Session, id: string) {
  const row = await ctx.repo.get(RESTORES, id);
  if (!row) throw notFound('Restore request not found');
  if (row.executedAt) throw conflict('Restore has already been executed');
  if (row.status !== 'approved') throw conflict('Restore must be approved before execution');
  const updated = await ctx.repo.update(RESTORES, id, {
    status: 'executed',
    executedAt: ctx.now(),
    executedBy: session.userId,
    suppressedDuplicateActions: ['notifications', 'finance_ledger'],
  });
  await ctx.audit.record({ action: 'data.restore.execute', actorId: session.userId, targetType: 'restore', targetId: id });
  return updated;
}

export async function listRestoreRequests(ctx: FeatureContext, filter: { status?: string } = {}) {
  return ctx.repo.find(RESTORES, filter.status ? { status: filter.status } : {}, { orderBy: 'createdAt', desc: true });
}

/* ------------------------------------------------------------------ exports */

export async function requestExport(ctx: FeatureContext, session: Session, input: any = {}) {
  const scope = input.scope || 'reports';
  if (!EXPORT_SCOPES.includes(scope)) throw badRequest(`scope must be one of ${EXPORT_SCOPES.join(', ')}`);
  const format = input.format || 'csv';
  if (!['csv', 'xlsx'].includes(format)) throw badRequest('format must be csv or xlsx');

  const containsSensitive = input.containsSensitive === true || scope === 'finance' || scope === 'all';
  if (containsSensitive && !hasPermission(session, 'data.backup.manage')) {
    throw forbidden('Sensitive data exports require the data.backup.manage permission');
  }
  if (!hasPermission(session, 'data.export.request') && !hasPermission(session, 'data.backup.manage')) {
    throw forbidden('Requires permission: data.export.request');
  }

  const row = await ctx.repo.insert(EXPORTS, {
    id: ctx.newId(),
    scope,
    format,
    containsSensitive,
    requestedBy: session.userId,
    status: 'pending',
    rowLimit: Math.min(Number(input.rowLimit ?? 1000) || 1000, 5000),
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'data.export.request',
    actorId: session.userId,
    targetType: 'export',
    targetId: row.id,
    detail: { scope, format, containsSensitive },
  });
  return row;
}

export async function listExports(ctx: FeatureContext) {
  return ctx.repo.find(EXPORTS, {}, { orderBy: 'createdAt', desc: true });
}

/* ------------------------------------------------------------------ imports */

export async function previewImport(ctx: FeatureContext, actorId: string, input: any = {}) {
  const target = input.target;
  const map = IMPORT_TARGETS[target];
  if (!map) throw badRequest(`target must be one of ${Object.keys(IMPORT_TARGETS).join(', ')}`);
  const rows = input.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw badRequest('rows must be a non-empty array');
  if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`At most ${MAX_IMPORT_ROWS} rows may be imported at once`);

  const seen = new Set<string>();
  const valid: Row[] = [];
  const invalid: Row[] = [];
  const conflicts: Row[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i] || {};
    const key = raw[map.keyField];
    if (key === undefined || key === null || String(key).trim() === '') {
      invalid.push({ row: i, reason: `missing ${map.keyField}` });
      continue;
    }
    const normalised = String(key).trim().toLowerCase();
    if (seen.has(normalised)) {
      invalid.push({ row: i, reason: `duplicate ${map.keyField} inside the file` });
      continue;
    }
    seen.add(normalised);
    const existing = await ctx.repo.findOne(map.table, { [map.keyField]: raw[map.keyField] });
    if (existing) {
      // an import must never silently overwrite an authoritative record
      conflicts.push({ row: i, key: raw[map.keyField], existingId: existing.id, requiresOverwriteConfirmation: true });
      continue;
    }
    valid.push({ row: i, value: raw });
  }

  const batch = await ctx.repo.insert(IMPORTS, {
    id: ctx.newId(),
    target,
    table: map.table,
    keyField: map.keyField,
    total: rows.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    conflictCount: conflicts.length,
    valid,
    invalid,
    conflicts,
    status: 'preview',
    requiresConfirmation: true,
    previewedBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'data.import.preview',
    actorId,
    targetType: 'import',
    targetId: batch.id,
    detail: { target, total: rows.length, conflicts: conflicts.length },
  });
  return {
    batchId: batch.id,
    target,
    total: rows.length,
    valid: valid.length,
    invalid: invalid.length,
    conflicts: conflicts.length,
    preview: { valid, invalid, conflicts },
    requiresConfirmation: true,
    status: 'preview',
  };
}

export async function commitImport(ctx: FeatureContext, actorId: string, batchId: string, input: any = {}) {
  const batch = await ctx.repo.get(IMPORTS, batchId);
  if (!batch) throw notFound('Import batch not found');
  if (batch.status !== 'preview') throw conflict(`Import batch is already ${batch.status}`);
  if (input.confirm !== true) throw badRequest('Bulk changes require explicit confirmation after preview');
  if (batch.conflictCount > 0 && input.allowOverwrite !== true) {
    throw conflict('Import cannot silently overwrite authoritative records', { conflicts: batch.conflicts });
  }

  let committed = 0;
  for (const entry of batch.valid || []) {
    await ctx.repo.insert(batch.table, { id: ctx.newId(), ...(entry.value || {}), importedBatchId: batch.id, createdAt: ctx.now() });
    committed += 1;
  }
  const updated = await ctx.repo.update(IMPORTS, batchId, {
    status: 'committed',
    committedCount: committed,
    committedAt: ctx.now(),
    committedBy: actorId,
    overwriteAuthorised: input.allowOverwrite === true,
  });
  await ctx.audit.record({
    action: 'data.import.commit',
    actorId,
    targetType: 'import',
    targetId: batchId,
    detail: { committed, skipped: batch.invalidCount, conflicts: batch.conflictCount },
  });
  return updated;
}

export async function listImports(ctx: FeatureContext) {
  return ctx.repo.find(IMPORTS, {}, { orderBy: 'createdAt', desc: true });
}

/* ---------------------------------------------------------------- integrity */

/** Lightweight integrity monitor: flags orphaned / unverifiable rows without leaking data. */
export async function integrityReport(ctx: FeatureContext) {
  const backups = await ctx.repo.find(BACKUPS, {});
  const completed = backups.filter((b) => b.status === 'completed');
  const verified = completed.filter((b) => b.integrityVerified && b.restoreVerified);
  const oldest = completed.length
    ? completed.reduce((acc, b) => (new Date(b.createdAt).getTime() < new Date(acc.createdAt).getTime() ? b : acc), completed[0])
    : null;
  return {
    backups: { total: backups.length, completed: completed.length, valid: verified.length },
    invalidBackups: completed.filter((b) => !(b.integrityVerified && b.restoreVerified)).map((b) => b.id),
    oldestBackupAt: oldest ? oldest.createdAt : null,
    restoreTestedRecently: verified.length > 0,
  };
}
