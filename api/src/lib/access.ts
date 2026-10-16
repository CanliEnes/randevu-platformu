import type { Db } from '../db/index.ts';
import { forbidden, notFound } from './errors.ts';

// Authorization: "is this user allowed to touch this business?"
// Owners can do everything; staff members only things about themselves.

export type BusinessAccess =
  | { role: 'owner'; businessId: number; timezone: string; ownStaffId: number | null }
  | { role: 'staff'; businessId: number; timezone: string; ownStaffId: number };

export async function getAccess(db: Db, userId: number, businessId: number): Promise<BusinessAccess | null> {
  const business = await db
    .selectFrom('businesses')
    .leftJoin('staff', (join) =>
      join.onRef('staff.business_id', '=', 'businesses.id').on('staff.user_id', '=', userId).on('staff.active', '=', true),
    )
    .select(['businesses.id', 'businesses.owner_id', 'businesses.timezone', 'staff.id as staffId'])
    .where('businesses.id', '=', businessId)
    .executeTakeFirst();
  if (!business) throw notFound('İşletme');
  if (business.owner_id === userId) {
    return { role: 'owner', businessId, timezone: business.timezone, ownStaffId: business.staffId };
  }
  if (business.staffId !== null) {
    return { role: 'staff', businessId, timezone: business.timezone, ownStaffId: business.staffId };
  }
  return null;
}

export async function requireOwner(db: Db, userId: number, businessId: number) {
  const access = await getAccess(db, userId, businessId);
  if (access?.role !== 'owner') throw forbidden();
  return access;
}

export async function requireMember(db: Db, userId: number, businessId: number) {
  const access = await getAccess(db, userId, businessId);
  if (!access) throw forbidden();
  return access;
}

/** Owners may act on any staff member of their business; staff only on themselves. */
export function canActOnStaff(access: BusinessAccess, staffId: number) {
  return access.role === 'owner' || access.ownStaffId === staffId;
}
