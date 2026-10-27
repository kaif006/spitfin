CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT,
  pw_hash      TEXT,
  display_name TEXT NOT NULL,
  is_guest     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A registered (non-guest) user must have both an email and a password hash.
  CONSTRAINT users_registered_has_credentials
    CHECK (is_guest OR (email IS NOT NULL AND pw_hash IS NOT NULL)),

  -- Display names are 3 to 16 characters (Section 10 of the plan).
  CONSTRAINT users_display_name_length
    CHECK (char_length(display_name) BETWEEN 3 AND 16)
);

-- Case-insensitive uniqueness. Guests have no email, so they are excluded.
CREATE UNIQUE INDEX users_email_lower_idx
  ON users (lower(email))
  WHERE email IS NOT NULL;

-- Lets us find old guests quickly when we clean them up later.
CREATE INDEX users_guest_created_idx
  ON users (created_at)
  WHERE is_guest;
