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
