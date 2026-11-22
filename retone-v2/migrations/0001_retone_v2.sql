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
CREATE TABLE IF NOT EXISTS retone_v2.reflections (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  keep TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES retone_v2.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS retone_v2.conversation_insights (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES retone_v2.rooms(id) ON DELETE CASCADE,
  checkpoint INTEGER NOT NULL,
  has_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  suggestion TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, checkpoint)
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
CREATE TABLE IF NOT EXISTS retone_v2.ai_reports (
  id UUID PRIMARY KEY,
  reporter_name TEXT NOT NULL,
  original_text TEXT NOT NULL,
  ai_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS retone_v2.friend_requests (
  from_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  to_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(from_id, to_id),
  CHECK(from_id <> to_id)
);
CREATE TABLE IF NOT EXISTS retone_v2.friendships (
  user_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, friend_id),
  CHECK(user_id <> friend_id)
);
CREATE TABLE IF NOT EXISTS retone_v2.blocks (
  blocker_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  blocked_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(blocker_id, blocked_id),
  CHECK(blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS retone_v2.auth_sessions (
  token UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON retone_v2.auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS retone_v2.admin_ip_lock (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  allowed_ip TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retone_v2.message_reactions (
  message_id UUID REFERENCES retone_v2.messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES retone_v2.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '👏')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(message_id, user_id, emoji)
);
ALTER TABLE retone_v2.message_reactions DROP CONSTRAINT IF EXISTS message_reactions_emoji_check;
ALTER TABLE retone_v2.message_reactions ADD CONSTRAINT message_reactions_emoji_check CHECK (emoji IN ('👍', '❤️', '😂', '👏', '✅'));

-- Safe for databases created before the information-check fields were added.
ALTER TABLE retone_v2.ai_cache ADD COLUMN IF NOT EXISTS info_level TEXT NOT NULL DEFAULT 'none';
ALTER TABLE retone_v2.ai_cache ADD COLUMN IF NOT EXISTS info_note TEXT;
ALTER TABLE retone_v2.ai_cache ADD COLUMN IF NOT EXISTS info_queries TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE retone_v2.users ADD COLUMN IF NOT EXISTS ai_intervention TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE retone_v2.users ADD COLUMN IF NOT EXISTS friend_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_friend_code_unique_idx ON retone_v2.users(friend_code) WHERE friend_code IS NOT NULL;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS reply_to UUID;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE retone_v2.agreements ADD COLUMN IF NOT EXISTS assignee_name TEXT NOT NULL DEFAULT '미정';
ALTER TABLE retone_v2.agreements ADD COLUMN IF NOT EXISTS deadline_text TEXT NOT NULL DEFAULT '미정';
ALTER TABLE retone_v2.agreements ADD COLUMN IF NOT EXISTS confirmations INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retone_v2.agreements ADD COLUMN IF NOT EXISTS revisions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retone_v2.room_members ADD COLUMN IF NOT EXISTS typing_until TIMESTAMPTZ;
ALTER TABLE retone_v2.users ADD COLUMN IF NOT EXISTS login_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retone_v2.users ADD COLUMN IF NOT EXISTS login_blocked_until TIMESTAMPTZ;
ALTER TABLE retone_v2.appointments ADD COLUMN IF NOT EXISTS fields JSONB NOT NULL DEFAULT '[]';
ALTER TABLE retone_v2.appointments ADD COLUMN IF NOT EXISTS source_message_id UUID REFERENCES retone_v2.messages(id) ON DELETE SET NULL;
ALTER TABLE retone_v2.appointments ADD COLUMN IF NOT EXISTS pending_change JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS appointment_source_unique ON retone_v2.appointments(source_message_id);
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS fact_result JSONB;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS ai_trigger TEXT;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS ai_context_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retone_v2.ai_cache ADD COLUMN IF NOT EXISTS warning_trigger TEXT;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS alignment_hint BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS alignment_kind TEXT;
ALTER TABLE retone_v2.messages ADD COLUMN IF NOT EXISTS alignment_summary TEXT;
ALTER TABLE retone_v2.agreements ADD COLUMN IF NOT EXISTS source_message_id UUID REFERENCES retone_v2.messages(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agreement_source_unique ON retone_v2.agreements(source_message_id) WHERE source_message_id IS NOT NULL;
