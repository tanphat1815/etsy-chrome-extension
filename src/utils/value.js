import { ADDRESS_FIELDS } from '../constants/address.schema.js';

export function isEmptyValue(v) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

export function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeScalar(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return v.trim();
  return v;
}

export function normalizeAddress(address = {}) {
  console.log(address)
  const normalized = {};
  for (const key of ADDRESS_FIELDS) {
    normalized[key] =
      address[key] !== undefined && address[key] !== null && address[key] !== ''
        ? address[key]
        : '—';
  }
  return normalized;
}