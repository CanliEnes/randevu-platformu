// Thin wrapper around fetch: JSON in, JSON out, errors as ApiError.
// The session lives in an httpOnly cookie, so there is no token to manage here.

export class ApiError extends Error {
  status: number;
  code: string;
  details?: { path: string; message: string }[];

  constructor(status: number, code: string, message: string, details?: { path: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? 'Bir şeyler ters gitti.', error?.details);
  }
  return data as T;
}

/** Turns an error into one sentence for the user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_FAILED' && error.details?.length) return error.details[0]!.message;
    return error.message;
  }
  return 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.';
}

// ---------- Response types ----------

export interface User {
  id: number;
  email: string;
  fullName: string;
}

export interface Membership {
  businessId: number;
  name: string;
  slug: string;
  role: 'owner' | 'staff';
  staffId?: number;
}

export interface Me {
  user: User;
  memberships: Membership[];
}

export interface BusinessSummary {
  id: number;
  name: string;
  slug: string;
  category: string;
  description: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  minPriceCents: number | null;
}

export interface Service {
  id: number;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  staffIds: number[];
  active?: boolean;
}

export interface StaffMember {
  id: number;
  displayName: string;
  title: string;
  serviceIds: number[];
}

export interface Review {
  id: number;
  rating: number;
  comment: string;
  createdAt: string;
  author: string;
  serviceName: string;
}

export interface BusinessPage {
  business: { id: number; name: string; slug: string; category: string; description: string; address: string; timezone: string };
  services: Service[];
  staff: StaffMember[];
  rating: { average: number | null; count: number };
  reviews: Review[];
}

export interface Availability {
  timezone: string;
  durationMinutes: number;
  slots: { start: string; staffIds: number[] }[];
}

export type DisplayStatus = 'upcoming' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: number;
  status: 'booked' | 'cancelled' | 'no_show';
  displayStatus: DisplayStatus;
  priceCents: number;
  note: string;
  start: string;
  end: string;
  businessId: number;
  businessName: string;
  businessSlug: string;
  timezone: string;
  staffId: number;
  staffName: string;
  serviceId: number;
  serviceName: string;
  customerId: number;
  customerName: string;
  customerEmail?: string;
  reviewRating: number | null;
  canCancel: boolean;
  canReview: boolean;
}

export interface ManageData {
  role: 'owner' | 'staff';
  ownStaffId: number | null;
  business: BusinessPage['business'];
  services: (Service & { active: boolean })[];
  staff: {
    id: number;
    displayName: string;
    title: string;
    active: boolean;
    email: string | null;
    serviceIds: number[];
    workingHours: { weekday: number; start: string; end: string }[];
  }[];
  timeOff: { id: number; staffId: number; reason: string; start: string; end: string }[];
}

export interface Stats {
  days: number;
  summary: {
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
    revenueCents: number;
    upcoming: number;
    cancellationRate: number;
    averageRating: number | null;
    reviewCount: number;
  };
  daily: { date: string; count: number; revenueCents: number }[];
  byHour: { hour: number; count: number }[];
  byWeekday: { weekday: number; count: number }[];
  topServices: { name: string; count: number; revenueCents: number }[];
  staff: { name: string; count: number; revenueCents: number; noShow: number }[];
}

export interface Email {
  id: number;
  subject: string;
  body: string;
  kind: string;
  createdAt: string;
}
