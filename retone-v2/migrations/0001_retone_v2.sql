-- Re:Tone v2 owns this schema. It intentionally never alters the legacy app tables.
CREATE SCHEMA IF NOT EXISTS retone_v2;

CREATE TABLE IF NOT EXISTS retone_v2.users (
  id UUID PRIMARY KEY,
  phone_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  ai_intervention TEXT NOT NULL DEFAULT 'standard',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS retone_v2.rooms (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_by UUID REFERENCES retone_v2.users(id),
  is_group BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS retone_v2.room_members (
  room_id UUID REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY(room_id, user_id)
);
CREATE TABLE IF NOT EXISTS retone_v2.messages (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES retone_v2.users(id),
  body TEXT NOT NULL,
  ai_verdict TEXT,
  ai_suggestion TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS retone_v2.agreements (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  assignee_id UUID REFERENCES retone_v2.users(id),
  starts_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  hidden_by UUID[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS retone_v2.appointments (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  place TEXT,
  created_by UUID REFERENCES retone_v2.users(id)
);
CREATE TABLE IF NOT EXISTS retone_v2.ai_cache (
  message_hash TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  suggestion TEXT,
  info_level TEXT NOT NULL DEFAULT 'none',
  info_note TEXT,
  info_queries TEXT[] NOT NULL DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe for databases created before the information-check fields were added.
ALTER TABLE retone_v2.ai_cache ADD COLUMN IF NOT EXISTS info_level TEXT NOT NULL DEFAULT 'none';
ALTER TABLE retone_v2.ai_cache ADD COLUMN IF NOT EXISTS info_note TEXT;
ALTER TABLE retone_v2.ai_cache ADD COLUMN IF NOT EXISTS info_queries TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE retone_v2.users ADD COLUMN IF NOT EXISTS ai_intervention TEXT NOT NULL DEFAULT 'standard';
