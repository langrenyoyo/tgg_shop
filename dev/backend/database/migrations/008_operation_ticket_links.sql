-- Link customer-service tickets with refund, delivery, and exception workflows.

CREATE INDEX IF NOT EXISTS idx_operation_ticket_linked ON operation_ticket(linked_type, linked_id);
CREATE INDEX IF NOT EXISTS idx_operation_ticket_priority_status ON operation_ticket(priority, status);
