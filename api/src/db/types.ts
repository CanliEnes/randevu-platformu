import type { ColumnType, Generated } from 'kysely';

// TypeScript view of the tables in migrations/*.sql.
// Range columns (period) are written with sql`tstzrange(...)` and read back
// with lower()/upper(), so their TypeScript type is just string.

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

export interface UsersTable {
  id: Generated<number>;
  email: string;
  password_hash: string;
  full_name: string;
  created_at: CreatedAt;
}

export interface SessionsTable {
  token_hash: string;
  user_id: number;
  expires_at: Timestamp;
  created_at: CreatedAt;
}

export interface BusinessesTable {
  id: Generated<number>;
  owner_id: number;
  name: string;
  slug: string;
  category: string;
  description: Generated<string>;
  address: Generated<string>;
  timezone: Generated<string>;
  created_at: CreatedAt;
}

export interface StaffTable {
  id: Generated<number>;
  business_id: number;
  user_id: number | null;
  display_name: string;
  title: Generated<string>;
  active: Generated<boolean>;
}

export interface ServicesTable {
  id: Generated<number>;
  business_id: number;
  name: string;
  description: Generated<string>;
  duration_minutes: number;
  price_cents: number;
  active: Generated<boolean>;
}

export interface StaffServicesTable {
  staff_id: number;
  service_id: number;
}

export interface WorkingHoursTable {
  id: Generated<number>;
  staff_id: number;
  weekday: number;
  start_time: string; // 'HH:MM:SS'
  end_time: string;
}

export interface TimeOffTable {
  id: Generated<number>;
  staff_id: number;
  period: string;
  reason: Generated<string>;
  created_at: CreatedAt;
}

export type AppointmentStatus = 'booked' | 'cancelled' | 'no_show';

export interface AppointmentsTable {
  id: Generated<number>;
  business_id: number;
  staff_id: number;
  service_id: number;
  customer_id: number;
  period: string;
  status: Generated<AppointmentStatus>;
  price_cents: number;
  note: Generated<string>;
  created_at: CreatedAt;
  cancelled_at: Timestamp | null;
  cancelled_by: number | null;
  reminder_sent_at: Timestamp | null;
}

export interface ReviewsTable {
  id: Generated<number>;
  appointment_id: number;
  business_id: number;
  customer_id: number;
  rating: number;
  comment: Generated<string>;
  created_at: CreatedAt;
}

export interface SentEmailsTable {
  id: Generated<number>;
  to_email: string;
  subject: string;
  body: string;
  kind: string;
  appointment_id: number | null;
  created_at: CreatedAt;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  businesses: BusinessesTable;
  staff: StaffTable;
  services: ServicesTable;
  staff_services: StaffServicesTable;
  working_hours: WorkingHoursTable;
  time_off: TimeOffTable;
  appointments: AppointmentsTable;
  reviews: ReviewsTable;
  sent_emails: SentEmailsTable;
}
