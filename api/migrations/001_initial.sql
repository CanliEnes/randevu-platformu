-- 001_initial.sql
-- Core schema. Every business rule that the database can enforce on its own
-- is enforced here, so a bug in application code cannot corrupt the data.

CREATE EXTENSION IF NOT EXISTS btree_gist; -- lets GiST indexes compare plain ids with "="
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text for e-mail addresses

-- A range type for "09:00-12:00" style working blocks (PostgreSQL has none built in).
CREATE TYPE timerange AS RANGE (subtype = time);

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         citext      NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  full_name     text        NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 80),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only the SHA-256 hash of the session token is stored: a leaked database
-- dump does not let anyone log in.
CREATE TABLE sessions (
  token_hash text        PRIMARY KEY,
  user_id    bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE businesses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      NOT NULL REFERENCES users (id),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category    text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  address     text        NOT NULL DEFAULT '',
  timezone    text        NOT NULL DEFAULT 'Europe/Istanbul',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX businesses_owner_id_idx ON businesses (owner_id);

CREATE TABLE staff (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  bigint  NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id      bigint  REFERENCES users (id) ON DELETE SET NULL, -- optional login for the staff member
  display_name text    NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 60),
  title        text    NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT true,
  UNIQUE (business_id, user_id),
  UNIQUE (id, business_id) -- target of the composite foreign key in appointments
);

CREATE TABLE services (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id      bigint  NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name             text    NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description      text    NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480 AND duration_minutes % 5 = 0),
  price_cents      integer NOT NULL CHECK (price_cents >= 0),
  active           boolean NOT NULL DEFAULT true,
  UNIQUE (id, business_id)
);

CREATE TABLE staff_services (
  staff_id   bigint NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  service_id bigint NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);
CREATE INDEX staff_services_service_id_idx ON staff_services (service_id);

-- Weekly schedule. A lunch break is simply the gap between two blocks.
-- weekday follows ISO 8601: 1 = Monday ... 7 = Sunday.
CREATE TABLE working_hours (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id   bigint   NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time     NOT NULL,
  end_time   time     NOT NULL,
  CHECK (start_time < end_time),
  -- Two blocks of the same person on the same day may not overlap.
  CONSTRAINT working_hours_no_overlap
    EXCLUDE USING gist (staff_id WITH =, weekday WITH =, timerange(start_time, end_time) WITH &&)
);

CREATE TABLE time_off (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id   bigint      NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  period     tstzrange   NOT NULL CHECK (NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period)),
  reason     text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_off_staff_period_idx ON time_off USING gist (staff_id, period);

CREATE TABLE appointments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  bigint      NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_id     bigint      NOT NULL,
  service_id   bigint      NOT NULL,
  customer_id  bigint      NOT NULL REFERENCES users (id),
  -- Half-open range [start, end): a 10:00-10:30 and a 10:30-11:00 appointment do not overlap.
  period       tstzrange   NOT NULL CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period)),
  status       text        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'no_show')),
  price_cents  integer     NOT NULL CHECK (price_cents >= 0), -- price at booking time
  note         text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by bigint      REFERENCES users (id),
  reminder_sent_at timestamptz,

  -- Staff and service must belong to the same business as the appointment.
  FOREIGN KEY (staff_id, business_id)   REFERENCES staff (id, business_id),
  FOREIGN KEY (service_id, business_id) REFERENCES services (id, business_id),

  -- THE core guarantee: no double booking, even under concurrent requests.
  CONSTRAINT appointments_staff_no_overlap
    EXCLUDE USING gist (staff_id WITH =, period WITH &&) WHERE (status <> 'cancelled'),
  -- A customer cannot be in two places at once either.
  CONSTRAINT appointments_customer_no_overlap
    EXCLUDE USING gist (customer_id WITH =, period WITH &&) WHERE (status <> 'cancelled'),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX appointments_business_start_idx ON appointments (business_id, lower(period));
CREATE INDEX appointments_customer_start_idx ON appointments (customer_id, lower(period));

CREATE TABLE reviews (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id bigint      NOT NULL UNIQUE REFERENCES appointments (id) ON DELETE CASCADE,
  business_id    bigint      NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id    bigint      NOT NULL REFERENCES users (id),
  rating         smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text        NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_business_id_idx ON reviews (business_id, created_at DESC);

-- Demo mailbox: every e-mail the system sends is also stored here so the
-- deployed demo can show them without a real mail server.
CREATE TABLE sent_emails (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email       citext      NOT NULL,
  subject        text        NOT NULL,
  body           text        NOT NULL,
  kind           text        NOT NULL,
  appointment_id bigint      REFERENCES appointments (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sent_emails_to_idx ON sent_emails (to_email, created_at DESC);
