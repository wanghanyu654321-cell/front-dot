# Core image upgrade and image rollback

This entry point replaces only the core image of an existing deployment. Review and authorize the exact published commit and tree before an operator runs it. The current development patch is uncommitted; its base commit does not contain these changes. Obtain the final new SHA and tree from the release operator. No real Docker or server command was executed during development.

Build from the committed source archive, never the working directory:

```sh
python3 scripts/deploy/build-target-image.py --sha "$RELEASE_SHA" --tree "$RELEASE_TREE" --manifest "$IMAGE_MANIFEST"
npm run build
node scripts/deploy/schema-manifest.mjs > "$SCHEMA_MANIFEST"
```

The builder derives labels from Git metadata and builds the archived commit in an isolated context. Build arguments cannot substitute an uncommitted source tree. The manifest records the local immutable image ID. Review and transport it with the matching local image; upgrade never pulls or builds. The schema manifest must be generated from that same reviewed source and compared to the installed ledger, including every checksum. This version requires existing schema 11; it never migrates an older database.

The operator supplies existing configuration paths. The script only stats those files (regular file, current owner, mode 600) and passes their paths to Compose for normal consumption. It does not source them, print values or request Docker environment inspection. Use an existing private mode 700 deployment directory owned by the operator.

```sh
python3 scripts/deploy/upgrade-image.py \
  --sha "$RELEASE_SHA" --tree "$RELEASE_TREE" --image "front-dot:$RELEASE_SHA" \
  --manifest "$IMAGE_MANIFEST" --schema-manifest "$SCHEMA_MANIFEST" \
  --deploy-dir "$DEPLOY_DIR" --core-config "$CORE_CONFIG_PATH" \
  --compose-config "$COMPOSE_CONFIG_PATH"
```

The retained `deploy.lock` inode is flocked for the entire upgrade and automatic recovery. Legacy scripts sourcing `common.sh` now acquire that same lock on apply. Never delete or replace the lock file. Each run creates its own private directory; `anchor.json` is atomically replaced and fsynced, together with its directory, before stopping core. It records the running old image ID, actual configured tag/version evidence, PG container/image/volume metadata, configuration metadata, schema ledger, aggregate counts and lease state. It never reads `state.previous`. Legacy images need no new manifest: the explicit fallback checks that their actual running tag resolves to the running immutable ID immediately before stop. This proves a local tag/ID relationship only; absent historical source provenance is recorded as absent, never inferred.

After stopping old core, the script verifies zero local running core containers and a valid free or expired database consumer lease. It starts core with `--no-deps --no-build --pull never --scale core=1`. It checks PG/volume/configuration anchors before every start, then checks exactly one local core, the expected immutable image, health and an active renewed lease. No command starts or recreates PG. Read-only psql transactions check schema/checksums and aggregate accounts, bindings, roles, configuration, ledger, draft and notification counts. Normal business increases are allowed; amounts need not increase. These count checks cannot prove field-by-field identity equality. Preservation also relies on the script issuing no database writes and the reviewed image's runtime contracts.

Health and local container counts do not prove absence of consumers on other hosts. The lease is the shared coordination boundary only for cooperating consumers using this database and bot. Operations must separately establish that no uncoordinated or foreign-host consumer exists; this script makes no global inventory claim. A missing, malformed or unknown lease fails closed.

Any post-stop failure attempts stop-new, local absence, lease release/expiry, PG/configuration anchor checks, then starts only the old immutable image recorded by this run. It never restores a database snapshot, changes accounts, rewrites bindings, or removes business additions. Version rollback does not roll back data. Recovery is bounded and remains under the same lock. A failed recovery reports `rollback_failed`; it does not report success or invoke another deploy pathway.

Explicit rollback uses the reviewed run directory, not deployment history guesses:

```sh
bash scripts/deploy/rollback-image.sh \
  --rollback-run "$REVIEWED_RUN_DIRECTORY" --deploy-dir "$DEPLOY_DIR" \
  --core-config "$CORE_CONFIG_PATH" --compose-config "$COMPOSE_CONFIG_PATH"
```

Keep the original anchor/run directory private and inspect the phase status. An anchor write failure stops before consumers are touched. Wrong targets, checksum mismatch, tag drift, unsafe metadata, PG/volume drift, unknown leases, multiple consumers, timeout and signals are refusals. Exit 0 means the requested command completed; exit 1 means refusal or a failed upgrade with recovery recorded separately; exit 2 means automatic rollback failed. This is an engineering command interface, not deployment authorization.

Synthetic command-interface verification (no real Docker):

```sh
python3 tests/deploy/image-upgrade.test.py
```
