-- The completed-setup marker is irreversible through application SQL. Its owner
-- foreign key also prevents deleting the sole owner and reopening registration.
CREATE TRIGGER instance_setup_no_delete
BEFORE DELETE ON instance_settings
BEGIN
  SELECT RAISE(ABORT, 'Completed setup cannot be reopened');
END;
--> statement-breakpoint
CREATE TRIGGER instance_setup_no_update
BEFORE UPDATE OF id, owner_id, setup_completed_at ON instance_settings
BEGIN
  SELECT RAISE(ABORT, 'Completed setup cannot be changed');
END;
--> statement-breakpoint
CREATE TRIGGER user_no_registration_after_setup
BEFORE INSERT ON user
WHEN EXISTS (SELECT 1 FROM instance_settings WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'Registration is closed');
END;
