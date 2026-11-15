import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateCompose(doc, mode = 'production') {
  const failures = [];
  const { pg, core, admin, driver } = doc.services ?? {};
  const offline = mode === 'offline';
  if (!pg || !core || !(offline ? driver : admin)) return ['missing_service'];
  for (const service of Object.values(doc.services)) {
    if (service.ports?.length) failures.push('private_service_ports');
    if (service.privileged || service.network_mode === 'host') failures.push('host_access');
    if (!/^front-dot:\$\{FRONT_DOT_SHA:\?required\}$|^[a-z0-9./-]+:\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?$|^[a-z0-9./-]+@sha256:[a-f0-9]{64}$/.test(service.image ?? '')) failures.push('floating_image');
  }
  if (Object.keys(doc.services).some(name => !['pg', 'core', offline ? 'driver' : 'admin'].includes(name))) failures.push('unexpected_service');
  if (core.deploy?.replicas !== 1) failures.push('single_consumer');
  if (core.image !== 'front-dot:${FRONT_DOT_SHA:?required}' || (offline ? driver : admin).image !== core.image) failures.push('sha_image');
  if (offline) {
    if (core.environment?.FRONT_DOT_CHANNEL !== 'offline' || core.environment?.AUDIT_PG_ALLOW !== 'isolated-synthetic' || core.env_file) failures.push('offline_only');
  } else {
    if (core.environment?.FRONT_DOT_CHANNEL !== 'wecom') failures.push('production_channel');
    if (Object.values(doc.services).some(service => Object.hasOwn(service.environment ?? {}, 'AUDIT_PG_ALLOW'))) failures.push('synthetic_switch');
    if (JSON.stringify(core.env_file) !== '["${ENV_FILE:?required}"]') failures.push('server_env_file');
  }
  if (pg.image !== 'postgres:17.6-bookworm') failures.push('pg17');
  if (doc.networks?.private?.internal !== true || JSON.stringify(core.networks) !== (offline ? '["private"]' : '["private","outbound"]') || JSON.stringify(pg.networks) !== '["private"]') failures.push('network_boundary');
  if (!offline && (!doc.networks?.outbound || doc.networks.outbound.internal)) failures.push('outbound_required');
  return failures;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = [
    ...validateCompose(JSON.parse(readFileSync('deploy/compose.json', 'utf8'))),
    ...validateCompose(JSON.parse(readFileSync('deploy/compose.e2e.json', 'utf8')), 'offline'),
  ];
  process.stdout.write(JSON.stringify({ check: 'compose-static', failures }) + '\n');
  process.exitCode = failures.length ? 1 : 0;
}
