// Shared payment-type normalizer.
//
// Maps a free-text hint (the Zapier "payment_type" string on the inbound webhook,
// or a QBO invoice's line/description text for the scheduled sync) to one of the
// app's enumerated payment_type values. Used by api/payments/webhook.js (inbound
// Zapier) and api/cron/qbo-sync.js (scheduled reconciliation) so both classify the
// same way.
export function normalizePaymentType(raw = '') {
  const t = String(raw).toLowerCase().replace(/[\s-_]+/g, '');
  if (t.includes('retainer') || t.includes('deposit') && t.includes('1') === false) return 'retainer';
  if (t.includes('dp1') || t.includes('deposit1') || t.includes('firstpay')) return 'dp1';
  if (t.includes('dp2') || t.includes('deposit2') || t.includes('secondpay')) return 'dp2';
  if (t.includes('dp3') || t.includes('deposit3')) return 'dp3';
  if (t.includes('cd') || t.includes('construction') || t.includes('permit')) return 'cd';
  if (t.includes('final') || t.includes('balance') || t.includes('last')) return 'final';
  return 'other';
}
