import type { FeatureContext, Row } from '../../core/types.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertNotSelfApproval } from '../../core/permissions.js';

/**
 * Feature 21 — Equipment & Inventory Management (slug: inventory)
 *
 * Tables
 *  - inventory_assets      one row per tracked asset (unique assetTag) with running unit counts
 *  - inventory_loans       issue/return lifecycle; every loan has timestamps + responsible actors
 *  - inventory_movements   append-only audit trail of stock movements (checkout/checkin/write_off/…)
 *
 * Unit invariant, always true after every write:
 *   quantity === onLoan + damaged + lost + available   (available never negative)
 */

export const ASSETS = 'inventory_assets';
export const LOANS = 'inventory_loans';
export const MOVES = 'inventory_movements';

const DEFAULT_LOAN_DAYS = 14;
const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'lost'];

export interface AssetCounts {
  quantity: number;
  onLoan: number;
  damaged: number;
  lost: number;
  available: number;
}

/** Derived unit counts. `available` is clamped at zero and is 0 once the asset is disposed. */
export function assetCounts(a: Row): AssetCounts {
  const quantity = Number(a?.quantity ?? 0);
  const onLoan = Number(a?.onLoan ?? 0);
  const damaged = Number(a?.damaged ?? 0);
  const lost = Number(a?.lost ?? 0);
  const available = a?.status === 'disposed' ? 0 : Math.max(0, quantity - onLoan - damaged - lost);
  return { quantity, onLoan, damaged, lost, available };
}

function withCounts(a: Row) {
  return { ...a, counts: assetCounts(a) };
}

/** Separation of duties, surfaced as a 403 AppError. */
function assertSeparate(actorId: string, ownerId: string, what: string) {
  try {
    assertNotSelfApproval(actorId, ownerId, what);
  } catch {
    throw forbidden(`Separation of duties: you cannot approve ${what} you raised`);
  }
}

function posInt(value: any, field: string): number {
  const n = Number(value ?? 1);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`${field} must be a positive integer`);
  return n;
}

export interface AssetInput {
  assetTag?: string;
  name?: string;
  category?: string;
  description?: string;
  source?: string;
  acquiredAt?: string;
  condition?: string;
  location?: string;
  custodianId?: string;
  quantity?: number;
  replacementValue?: number;
  warrantyUntil?: string;
  attachments?: string[];
}

export async function createAsset(ctx: FeatureContext, actorId: string, input: AssetInput) {
  const tag = (input?.assetTag || '').trim();
  const name = (input?.name || '').trim();
  if (!tag) throw badRequest('assetTag is required');
  if (!name) throw badRequest('name is required');
  if (input?.condition && !CONDITIONS.includes(input.condition)) {
    throw badRequest(`condition must be one of ${CONDITIONS.join(', ')}`);
  }
  const quantity = posInt(input?.quantity ?? 1, 'quantity');
  const duplicate = await ctx.repo.findOne(ASSETS, { assetTag: tag });
  if (duplicate) throw conflict(`Asset tag ${tag} already exists`, { assetId: duplicate.id });

  const asset = await ctx.repo.insert(ASSETS, {
    id: ctx.newId(),
    assetTag: tag,
    name,
    category: input?.category || 'equipment',
    description: input?.description ?? null,
    source: input?.source ?? null,
    acquiredAt: input?.acquiredAt ?? ctx.now(),
    condition: input?.condition || 'good',
    location: input?.location ?? null,
    custodianId: input?.custodianId ?? null,
    quantity,
    onLoan: 0,
    damaged: 0,
    lost: 0,
    replacementValue: input?.replacementValue ?? null,
    warrantyUntil: input?.warrantyUntil ?? null,
    attachments: input?.attachments ?? [],
    status: 'available',
    disposalStatus: 'none',
    disposalRequestedBy: null,
    disposalReason: null,
    disposalApprovedBy: null,
    disposedAt: null,
    createdBy: actorId,
    createdAt: ctx.now(),
  });
  await ctx.repo.insert(MOVES, {
    id: ctx.newId(),
    assetId: asset.id,
    kind: 'register',
    quantity,
    actorId,
    at: ctx.now(),
    condition: asset.condition,
    note: null,
  });
  await ctx.audit.record({
    action: 'inventory.asset.create',
    actorId,
    targetType: 'inventory_asset',
    targetId: asset.id,
    detail: { assetTag: tag, quantity },
  });
  return withCounts(asset);
}

export async function listAssets(
  ctx: FeatureContext,
  filter: { status?: string; category?: string } = {},
  opts: { limit?: number; offset?: number } = {},
) {
  const q: Row = {};
  if (filter.status) q.status = filter.status;
  if (filter.category) q.category = filter.category;
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const rows = await ctx.repo.find(ASSETS, q, { limit, offset, orderBy: 'createdAt', desc: true });
  const total = await ctx.repo.count(ASSETS, q);
  return { rows: rows.map(withCounts), total, limit, offset };
}

export async function getAsset(ctx: FeatureContext, id: string, opts: { canSeeValue?: boolean } = {}) {
  const asset = await ctx.repo.get(ASSETS, id);
  if (!asset) throw notFound('Asset not found');
  const now = ctx.now();
  const loans = (await ctx.repo.find(LOANS, { assetId: id }, { orderBy: 'checkedOutAt', desc: true })).map((l) => ({
    ...l,
    overdue: isOverdue(l, now),
  }));
  const movements = await ctx.repo.find(MOVES, { assetId: id }, { orderBy: 'at', desc: true });
  const detail: Row = { ...withCounts(asset), loans, movements };
  if (!opts.canSeeValue) detail.replacementValue = null;
  return detail;
}

export function isOverdue(loan: Row, now: string): boolean {
  if (!loan) return false;
  if (loan.status !== 'open') return false;
  if (!loan.dueAt) return false;
  return new Date(loan.dueAt).getTime() < new Date(now).getTime();
}

export async function checkout(
  ctx: FeatureContext,
  actorId: string,
  assetId: string,
  input: { borrowerId?: string; quantity?: number; dueAt?: string } = {},
) {
  const asset = await ctx.repo.get(ASSETS, assetId);
  if (!asset) throw notFound('Asset not found');
  if (asset.status === 'disposed' || asset.status === 'retired') {
    throw conflict(`Asset is ${asset.status} and cannot be issued`);
  }
  const borrowerId = input?.borrowerId || actorId;
  const qty = posInt(input?.quantity ?? 1, 'quantity');
  const counts = assetCounts(asset);
  if (qty > counts.available) {
    throw conflict(`Only ${counts.available} of ${asset.assetTag} available for issue`, { available: counts.available });
  }
  const dueAt =
    input?.dueAt ?? new Date(new Date(ctx.now()).getTime() + DEFAULT_LOAN_DAYS * 24 * 3600 * 1000).toISOString();

  const loan = await ctx.repo.insert(LOANS, {
    id: ctx.newId(),
    assetId,
    borrowerId,
    quantity: qty,
    returnedQuantity: 0,
    dueAt,
    status: 'open',
    checkedOutAt: ctx.now(),
    checkedOutBy: actorId,
    returnedAt: null,
    returnedBy: null,
    returnCondition: null,
  });
  const updated = await ctx.repo.update(ASSETS, assetId, { onLoan: counts.onLoan + qty, status: 'in_use' });
  await ctx.repo.insert(MOVES, {
    id: ctx.newId(),
    assetId,
    kind: 'checkout',
    quantity: qty,
    actorId,
    borrowerId,
    at: ctx.now(),
    condition: null,
    note: null,
  });
  await ctx.audit.record({
    action: 'inventory.loan.checkout',
    actorId,
    targetType: 'inventory_asset',
    targetId: assetId,
    detail: { loanId: loan.id, borrowerId, quantity: qty, dueAt },
  });
  return { loan: { ...loan, overdue: isOverdue(loan, ctx.now()) }, asset: withCounts(updated ?? asset) };
}

export async function checkin(
  ctx: FeatureContext,
  actorId: string,
  assetId: string,
  input: { loanId?: string; borrowerId?: string; quantity?: number; condition?: string } = {},
) {
  const asset = await ctx.repo.get(ASSETS, assetId);
  if (!asset) throw notFound('Asset not found');
  const qty = posInt(input?.quantity ?? 1, 'quantity');
  const condition = input?.condition || 'good';
  if (!CONDITIONS.includes(condition)) throw badRequest(`condition must be one of ${CONDITIONS.join(', ')}`);

  const open = (
    await ctx.repo.find(LOANS, { assetId, status: 'open' }, { orderBy: 'checkedOutAt' })
  ).filter((l) => (input?.loanId ? l.id === input.loanId : true) && (input?.borrowerId ? l.borrowerId === input.borrowerId : true));

  const outstanding = open.reduce((s, l) => s + Number(l.quantity || 0), 0);
  if (outstanding === 0) throw conflict('No open loan exists for this asset');
  if (qty > outstanding) throw conflict(`Cannot return ${qty}: only ${outstanding} item(s) are on loan`, { outstanding });

  let remaining = qty;
  for (const loan of open) {
    if (remaining <= 0) break;
    const held = Number(loan.quantity || 0);
    const take = Math.min(remaining, held);
    const left = held - take;
    const returnedSoFar = Number(loan.returnedQuantity || 0);
    if (left === 0) {
      await ctx.repo.update(LOANS, loan.id, {
        quantity: 0,
        returnedQuantity: returnedSoFar + take,
        status: 'returned',
        returnedAt: ctx.now(),
        returnedBy: actorId,
        returnCondition: condition,
      });
    } else {
      await ctx.repo.update(LOANS, loan.id, { quantity: left, returnedQuantity: returnedSoFar + take });
    }
    remaining -= take;
  }

  const counts = assetCounts(asset);
  const onLoan = Math.max(0, counts.onLoan - qty);
  const damaged = condition === 'damaged' ? counts.damaged + qty : counts.damaged;
  const lost = condition === 'lost' ? counts.lost + qty : counts.lost;
  const updated = await ctx.repo.update(ASSETS, assetId, {
    onLoan,
    damaged,
    lost,
    condition: condition === 'good' || condition === 'new' ? asset.condition : condition,
    status: asset.status === 'disposed' ? 'disposed' : onLoan === 0 ? 'available' : 'in_use',
  });
  await ctx.repo.insert(MOVES, {
    id: ctx.newId(),
    assetId,
    kind: 'checkin',
    quantity: qty,
    actorId,
    borrowerId: input?.borrowerId ?? null,
    at: ctx.now(),
    condition,
    note: null,
  });
  await ctx.audit.record({
    action: 'inventory.loan.checkin',
    actorId,
    targetType: 'inventory_asset',
    targetId: assetId,
    detail: { quantity: qty, condition },
  });
  return { asset: withCounts(updated ?? asset) };
}

/** Write off stock as damaged or lost. Can never exceed what is physically available. */
export async function writeOff(
  ctx: FeatureContext,
  actorId: string,
  assetId: string,
  input: { quantity?: number; kind?: string; note?: string } = {},
) {
  const asset = await ctx.repo.get(ASSETS, assetId);
  if (!asset) throw notFound('Asset not found');
  const kind = input?.kind;
  if (kind !== 'damaged' && kind !== 'lost') throw badRequest("kind must be 'damaged' or 'lost'");
  const qty = posInt(input?.quantity ?? 1, 'quantity');
  const counts = assetCounts(asset);
  if (qty > counts.available) {
    throw conflict(`Only ${counts.available} unit(s) available to write off`, { available: counts.available });
  }
  const patch: Row = kind === 'damaged' ? { damaged: counts.damaged + qty } : { lost: counts.lost + qty };
  if (kind === 'damaged') patch.condition = 'damaged';
  const updated = await ctx.repo.update(ASSETS, assetId, patch);
  await ctx.repo.insert(MOVES, {
    id: ctx.newId(),
    assetId,
    kind: 'write_off',
    quantity: qty,
    actorId,
    at: ctx.now(),
    condition: kind,
    note: input?.note ?? null,
  });
  await ctx.audit.record({
    action: `inventory.asset.write_off.${kind}`,
    actorId,
    targetType: 'inventory_asset',
    targetId: assetId,
    detail: { quantity: qty, note: input?.note ?? null },
  });
  return withCounts(updated ?? asset);
}

export async function requestDisposal(ctx: FeatureContext, actorId: string, assetId: string, input: { reason?: string } = {}) {
  const asset = await ctx.repo.get(ASSETS, assetId);
  if (!asset) throw notFound('Asset not found');
  if (asset.status === 'disposed') throw conflict('Asset is already disposed');
  if (asset.disposalStatus === 'requested') throw conflict('A disposal request is already pending');
  if (Number(asset.onLoan || 0) > 0) throw conflict('Cannot request disposal while units are on loan');
  const updated = await ctx.repo.update(ASSETS, assetId, {
    disposalStatus: 'requested',
    disposalRequestedBy: actorId,
    disposalRequestedAt: ctx.now(),
    disposalReason: input?.reason ?? null,
  });
  await ctx.audit.record({
    action: 'inventory.asset.disposal.request',
    actorId,
    targetType: 'inventory_asset',
    targetId: assetId,
    detail: { reason: input?.reason ?? null },
  });
  return withCounts(updated ?? asset);
}

export async function approveDisposal(ctx: FeatureContext, actorId: string, assetId: string) {
  const asset = await ctx.repo.get(ASSETS, assetId);
  if (!asset) throw notFound('Asset not found');
  if (asset.disposalStatus !== 'requested') throw conflict('There is no disposal request awaiting approval');
  assertSeparate(actorId, asset.disposalRequestedBy, 'a disposal request');
  const updated = await ctx.repo.update(ASSETS, assetId, {
    status: 'disposed',
    disposalStatus: 'approved',
    disposalApprovedBy: actorId,
    disposedAt: ctx.now(),
  });
  await ctx.audit.record({
    action: 'inventory.asset.disposal.approve',
    actorId,
    targetType: 'inventory_asset',
    targetId: assetId,
    detail: { requestedBy: asset.disposalRequestedBy },
  });
  return withCounts(updated ?? asset);
}

export async function listMyLoans(ctx: FeatureContext, userId: string) {
  const now = ctx.now();
  const loans = await ctx.repo.find(LOANS, { borrowerId: userId }, { orderBy: 'checkedOutAt', desc: true });
  return loans.map((l) => ({ ...l, overdue: isOverdue(l, now) }));
}

export async function listOverdueLoans(ctx: FeatureContext) {
  const now = ctx.now();
  const open = await ctx.repo.find(LOANS, { status: 'open' });
  return open.filter((l) => isOverdue(l, now)).map((l) => ({ ...l, overdue: true }));
}
