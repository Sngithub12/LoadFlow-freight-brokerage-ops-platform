'use strict';

// Pure function: given a carrier's compliance record and a load's requirements,
// decide whether the assignment should auto-flag. Kept side-effect free so it's
// easy to unit-test and to re-run whenever a compliance record changes.
function evaluateCompliance(complianceRecord, load) {
  const reasons = [];

  if (!complianceRecord) {
    reasons.push('Carrier has no compliance record on file');
    return { flagged: true, reason: reasons.join('; ') };
  }

  if (complianceRecord.authority_status !== 'active') {
    reasons.push(`MC/DOT authority is "${complianceRecord.authority_status}"`);
  }

  if (!complianceRecord.insurance_expiry) {
    reasons.push('No insurance expiry on file');
  } else {
    const expiry = new Date(complianceRecord.insurance_expiry + 'T23:59:59Z');
    if (expiry.getTime() < Date.now()) {
      reasons.push(`Insurance expired on ${complianceRecord.insurance_expiry}`);
    }
  }

  const equipment = JSON.parse(complianceRecord.approved_equipment || '[]');
  if (load.equipment_type && !equipment.includes(load.equipment_type)) {
    reasons.push(`Carrier not approved for equipment type "${load.equipment_type}"`);
  }

  const commodities = JSON.parse(complianceRecord.approved_commodities || '[]');
  if (load.commodity_type && !commodities.includes(load.commodity_type)) {
    reasons.push(`Carrier not approved for commodity type "${load.commodity_type}"`);
  }

  return { flagged: reasons.length > 0, reason: reasons.length ? reasons.join('; ') : null };
}

// Renewal-alert classification (stretch goal: "compliance expiry renewal
// alerts"). Separate from evaluateCompliance() above on purpose — that
// function decides whether a specific load can proceed; this one is about
// proactively surfacing carriers that need attention *before* they're ever
// assigned to a load, which is the actual point of a renewal alert.
const EXPIRY_WARNING_WINDOW_DAYS = 30;

function classifyExpiry(complianceRecord) {
  if (!complianceRecord) return { level: 'missing', message: 'No compliance record on file', daysRemaining: null };
  if (complianceRecord.authority_status !== 'active') {
    return { level: 'critical', message: `MC/DOT authority is "${complianceRecord.authority_status}"`, daysRemaining: null };
  }
  if (!complianceRecord.insurance_expiry) {
    return { level: 'critical', message: 'No insurance expiry on file', daysRemaining: null };
  }
  const expiry = new Date(complianceRecord.insurance_expiry + 'T23:59:59Z');
  const daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysRemaining < 0) {
    return { level: 'critical', message: `Insurance expired ${Math.abs(daysRemaining)} day(s) ago`, daysRemaining };
  }
  if (daysRemaining <= EXPIRY_WARNING_WINDOW_DAYS) {
    return { level: 'warning', message: `Insurance expires in ${daysRemaining} day(s)`, daysRemaining };
  }
  return { level: 'ok', message: `Insurance valid for ${daysRemaining} more day(s)`, daysRemaining };
}

module.exports = { evaluateCompliance, classifyExpiry, EXPIRY_WARNING_WINDOW_DAYS };
