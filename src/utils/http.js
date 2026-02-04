/**
 * Parse response body robustly.
 * @param {Response} res
 * @returns {Promise<any>} JSON, fallback => string
 */
export async function readResponseBody(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  if (ct.includes("json")) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }
  return text;
}
