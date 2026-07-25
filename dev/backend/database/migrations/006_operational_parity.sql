-- Operational parity tables for user-facing service entries and admin handling.

CREATE TABLE IF NOT EXISTS operation_ticket (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES app_user(id),
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('customer_service', 'feedback', 'business', 'recruiting')),
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'resolved', 'closed')),
  admin_reply TEXT,
  handled_by_role_id TEXT,
  linked_type TEXT,
  linked_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operation_ticket_type_status ON operation_ticket(ticket_type, status);
CREATE INDEX IF NOT EXISTS idx_operation_ticket_user_created ON operation_ticket(user_id, created_at);
