/** Only fixed categories and safe numeric diagnostics cross the logging boundary. */
const routes = ['快通道', '模型', '追问'] as const;
const gates = ['not_applicable', 'accepted', 'permission', 'schema', 'amount', 'uncertain', 'fallback',
  'closing', 'stale_consumer', 'duplicate', 'failed', 'timeout', 'cancelled', 'empty', 'natural-sentence',
  'not-standard-list', 'segment-amount', 'new-customer', 'customer', 'employee', 'employee-unknown',
  'employee-not-name', 'compound', 'invalid-format', 'not-customer-name', 'unseen-makeup', 'contaminated-line'] as const;
const identityReasons = ['missing_domain', 'no_binding', 'ambiguous', 'inactive', 'mismatch', 'invalid_directory', 'permission'] as const;
const errors = ['none', 'schema', 'amount', 'uncertain', 'permission', 'fallback', 'timeout', 'cancelled', 'rate_limit', 'model_error', 'processing_error'] as const;
function category(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}
export function safeSequence(value: unknown): string | null {
  if (typeof value === 'bigint') return value >= 0n && value < 10n ** 40n ? value.toString(10) : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(value) ? value : null;
}
export function safeInboundDiagnostics(fields: Record<string, unknown>): Record<string, unknown> {
  // Do not coerce objects: toString/toJSON/getters can contain user content or throw.
  const get = (key: string): unknown => {
    try { return Object.getOwnPropertyDescriptor(fields, key)?.value; } catch { return undefined; }
  };
  const ms = get('modelMs');
  const identityReason = category(get('identityReason'), identityReasons, '');
  return { event: 'inbound_message', ...(identityReason ? { identityReason } : {}), route: category(get('route'), routes, '追问'),
    gateReason: category(get('gateReason'), gates, 'not_applicable'),
    pendingSequence: safeSequence(get('pendingSequence')),
    modelMs: typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : 0,
    errorCategory: category(get('errorCategory'), errors, 'none') };
}
