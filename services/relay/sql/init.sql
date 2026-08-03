CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  frozen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signing_public_key TEXT NOT NULL,
  x25519_public_key TEXT NOT NULL,
  push_platform TEXT,
  push_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by_device_id TEXT NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS delivery_audit (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  envelope_id TEXT NOT NULL,
  sender_device_id TEXT NOT NULL REFERENCES devices(id),
  recipient_device_id TEXT NOT NULL REFERENCES devices(id),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stamp_bundles (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  initiator_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  share_count INTEGER NOT NULL CHECK (share_count BETWEEN 2 AND 10),
  bundle_sequence INTEGER NOT NULL CHECK (bundle_sequence >= 0),
  state TEXT NOT NULL CHECK (
    state IN ('proposed', 'pairing', 'ready', 'consumed', 'expired', 'failed')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_message_id TEXT UNIQUE,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, initiator_user_id, recipient_user_id, bundle_sequence)
);

CREATE TABLE IF NOT EXISTS stamp_helper_pairs (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES stamp_bundles(id) ON DELETE CASCADE,
  share_index INTEGER NOT NULL CHECK (share_index BETWEEN 0 AND 9),
  hpke_encapsulation TEXT,
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (
    state IN ('waiting', 'paired', 'confirmed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bundle_id, share_index)
);

CREATE TABLE IF NOT EXISTS stamp_helper_registrations (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL UNIQUE,
  hpke_public_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attached_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stamp_helper_sides (
  pair_id TEXT NOT NULL REFERENCES stamp_helper_pairs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('initiator', 'recipient')),
  invite_token_hash TEXT UNIQUE,
  helper_registration_id TEXT UNIQUE REFERENCES stamp_helper_registrations(id),
  hpke_public_key TEXT,
  joined_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (pair_id, role)
);

ALTER TABLE stamp_helper_sides
  ALTER COLUMN invite_token_hash DROP NOT NULL;

ALTER TABLE stamp_helper_sides
  ADD COLUMN IF NOT EXISTS helper_registration_id TEXT UNIQUE
  REFERENCES stamp_helper_registrations(id);

CREATE TABLE IF NOT EXISTS stamp_helper_attachment_claims (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES stamp_helper_registrations(id) ON DELETE CASCADE,
  pair_id TEXT NOT NULL,
  role TEXT NOT NULL,
  claimant_user_id TEXT NOT NULL REFERENCES users(id),
  link_code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (pair_id, role) REFERENCES stamp_helper_sides(pair_id, role) ON DELETE CASCADE,
  UNIQUE (registration_id, link_code_hash)
);

CREATE INDEX IF NOT EXISTS stamp_helper_claims_pending_idx
  ON stamp_helper_attachment_claims (registration_id, expires_at)
  WHERE approved_at IS NULL;

CREATE TABLE IF NOT EXISTS stamp_messages (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version = 2),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  bundle_id TEXT NOT NULL UNIQUE REFERENCES stamp_bundles(id),
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  ciphertext TEXT NOT NULL CHECK (ciphertext ~ '^[A-Z]{1,26}$'),
  sender_signing_key_id TEXT NOT NULL REFERENCES devices(id),
  signature TEXT NOT NULL,
  client_created_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stamp_messages_recipient_pending_idx
  ON stamp_messages (recipient_user_id, accepted_at)
  WHERE acknowledged_at IS NULL;
