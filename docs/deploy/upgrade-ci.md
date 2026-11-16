# Related CI commands

The new PG fixtures start and reap their own PostgreSQL 17 child processes through the repository helper. They choose loopback ports and verify the reached server's data directory. They do not consume a configured shared URL or prefilled runtime. The append test imports its public synthetic runtime from the repository and launches only its own child handles under a loopback network guard. Child crashes use a synthetic lease clock; no platform or model connection is made. Synthetic evidence remains in the test temporary directory for review.

| Workflow / step | Related local command | Difference |
| --- | --- | --- |
| check / Model entry boundary and deployment contracts | `npx vitest run tests/e2e tests/deploy` | Existing step; default config excludes PG. |
| check / Upgrade compatibility and command interface | `npm run test:upgrade` and `npm run test:upgrade:image` | Exact allowlist of affected unit suites plus executable fake Docker. |
| check / typecheck, build | `npm run typecheck`; `npm run build` | Local restricted collection uses a source copy and an explicit test include, to avoid sealed files. |
| pg / Owned PG upgrade regressions | `npm run test:upgrade:pg` | Eight specific integration files, each with an owned lifecycle; retains both existing appointment races of 20 rounds. |
| pg / Concurrent employee confirmation repeated five times | `npm run test:pg -- tests/role-eval/employee-loop-pg-m02.integration.test.ts` repeated five times | Restricted local equivalent uses the precise PG config with that same file. |
| pg / PG integration tests (full suite) | `npm run test:pg` | Existing broader step remains unchanged; it is outside the restricted local execution scope. |
| check / test:ci | `npm run test:ci` | Existing broader step remains unchanged; it is outside the restricted local execution scope. |

CI uses Node 22. A local Node 24 result is recorded as Node 24 and is not a Node 22 pass. Development collection does not grant admission or deployment authorization. Publishing and actual remote CI require separate operator action.
