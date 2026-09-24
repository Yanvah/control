# Back up, restore, and upgrade

Keep the SQLite database, matching `CONTROL_AUTH_SECRET` and `CONTROL_ENCRYPTION_KEY`, application image/revision, and migration history together as a recovery set. Store secrets separately in a protected secret manager and link them to the backup record. The encryption key also authenticates audit history; losing or replacing it makes existing credentials/history unusable. Database snapshots are sensitive even though product credentials are encrypted.

Run one Control process per database. Stop it for the maintenance commands below. `--offline` is an operator acknowledgement, not proof that all other writers have stopped. Do not copy only a live SQLite main file: its WAL can contain committed changes not yet checkpointed into that file.

## Create and verify a backup

Use a unique filename for each snapshot. The tool never overwrites one.

```bash
docker compose stop control
docker compose run --rm --no-deps control node scripts/database-maintenance.mjs backup --offline --output /data/backups/control-preupgrade.db
docker compose run --rm --no-deps control node scripts/database-maintenance.mjs verify --input /data/backups/control-preupgrade.db
```

Backup uses SQLite's backup API and validates the resulting snapshot. Verification checks SQLite integrity, foreign keys, and committed migration hashes. It does not decrypt credentials or authenticate the HMAC audit chain; that requires application startup with the matching encryption key.

Copy the completed snapshot off the volume before restarting:

```bash
mkdir -p backups
chmod 700 backups
docker compose cp control:/data/backups/control-preupgrade.db backups/control-preupgrade.db
chmod 600 backups/control-preupgrade.db
docker compose start control
```

Use a protected off-host storage location for the snapshot and its matching key references. A backup left on the same disk is not disaster recovery. Preserve file permissions during transfer; encrypt backups when storing them outside your trusted host. Retain the image digest/revision and record the most recently verified audit head/count separately. Rehearse restoration periodically, not only after a failure.

## Restore into a fresh volume

Keep the original volume intact. The restore command refuses to overwrite an existing database or its WAL/SHM files. This example uses a distinct Compose project named `control-restore`, creating a new data volume. Use the same compatible image and matching `.env.production`; do not run production and recovery against the same volume or browser port.

```bash
docker compose stop control
docker compose -p control-restore create control
docker compose -p control-restore cp backups/control-preupgrade.db control:/data/restore.db
```

`docker compose cp` can create a root-owned destination. Set ownership and permissions on this one staged file before using the normal non-root maintenance process:

```bash
docker compose -p control-restore run --rm --no-deps --user 0:0 --cap-add CHOWN control node -e 'const fs=require("node:fs"); fs.chmodSync("/data/restore.db",0o600); fs.chownSync("/data/restore.db",10001,10001);'
docker compose -p control-restore run --rm --no-deps control node scripts/database-maintenance.mjs restore --offline --input /data/restore.db
docker compose -p control-restore up -d
docker compose -p control-restore ps
```

Only the file-ownership command runs as root with the single `CHOWN` capability; the application and restore command retain the default UID 10001 and dropped capabilities. Restore validates the source and copied database before accepting it. Startup applies any supported newer migrations, verifies the full audit chain, and marks interrupted audit requests unknown without replaying mutations.

Verify owner login, product registration/capabilities, credential usability, and **Audit Log → Verify integrity** through the configured HTTPS origin. Compare the head/count with the backup checkpoint. A newly added startup recovery event can legitimately advance the head; inspect its sequence. SaaS state is not restored by a Control backup. Changes made remotely after the snapshot still exist, and old local receipts may be absent; inspect the SaaS before attempting any operation again.

For a rehearsal, use an isolated host/port and restrict outbound SaaS access so tests cannot mutate production. If you change the origin for the rehearsal, use password login; existing passkeys are bound to the original hostname. Continue to use `-p control-restore` for every command against the restored project. Decide which volume is authoritative before resuming work; do not delete the original until recovery has been verified and its retention period has passed.

## Upgrade

1. Read the target version's changelog and compatibility notes. Retain the current image and secrets. Confirm there is enough free disk space for the database, migration work, and a complete backup.
2. Quiesce administrative work and create/verify the stopped-service backup above. Save an audit head/count outside the instance. Stop Control again before deploying the upgrade.
3. Obtain the reviewed target source and build a uniquely tagged local image from its locked dependencies:

   ```bash
   npm ci
   docker build -t yanvah-control:upgrade-candidate .
   ```

   For a published release, use its verified immutable GHCR digest instead of rebuilding it locally.
4. Preserve `.env.production` and the existing volume. Start the candidate image without rebuilding:

   ```bash
   CONTROL_IMAGE=yanvah-control:upgrade-candidate docker compose up -d --no-build control
   docker compose logs --tail=100 control
   docker compose ps
   ```

   Keep the selected `CONTROL_IMAGE` in the Compose interpolation environment for later commands. Migration failure exits startup; repeated restarts are not a repair procedure.
5. Verify readiness, login/passkeys, product discovery, an appropriate test operation, its audit event, integrity verification, and persistence after restart. Retain the pre-upgrade backup and old image until the upgrade is accepted.

An application rollback is not a database rollback. Never point an old image at a database migrated by a newer incompatible version. Stop the new service and restore the pre-upgrade snapshot into a fresh volume using the old image and matching secrets. Reconcile any SaaS operations performed since the snapshot; restoration does not undo them.

## Database migration policy

- Migrations are ordered, committed SQL files plus Drizzle metadata under `src/db/migrations/`. Their hashes/order are part of release history. Once used outside disposable development, do not edit, reorder, rename, or delete them; add a new forward migration.
- Startup validates and applies pending migrations before readiness. Maintenance tools reject unknown/newer or modified migration histories. `npm run db:migrate` is the explicit source-checkout equivalent. No schema-push or automatic database reset is supported in production.
- There are no down migrations. Every schema-bearing release must document its supported upgrade path and require a verified pre-upgrade backup. Version 0.x does not imply database compatibility between arbitrary revisions.
- Test both a fresh database and an existing prior-version database, rerunning migrations, interrupted/failing startup, and restoration into an empty target. Do not alter historical fixtures to hide a compatibility failure.
- This release carries authentication/ownership migrations, `0002_product_registry`, `0003_operation_receipts`, and `0004_audit_trail`. First startup with audit support imports legacy receipts once, preserving timestamps and marking the import. Older login/registry history cannot be reconstructed.
- Never delete audit history, ownership markers, or operation receipts during an upgrade. They enforce integrity, permanent setup closure, and duplicate-attempt safety. Restore must retain all of them.

SQLite integrity and a valid audit chain establish useful checks, but neither proves freshness. Tail deletion or restoration of an older valid database needs an independently retained checkpoint to detect. See the [threat model](THREAT-MODEL.md).
