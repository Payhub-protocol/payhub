// Uses relative paths so it works both locally and on Vercel
async function request(path, opts = {}) {
  const base = typeof window !== "undefined" ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000");
  const res  = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json;
}

export const api = {
  registerPayment:  (body)              => request("/api/payments/register",  { method: "POST", body: JSON.stringify(body) }),
  getPayment:       (id)                => request(`/api/payments/${id}`),
  registerDispute:  (id, body)          => request(`/api/payments/${id}/dispute/register`,  { method: "POST", body: JSON.stringify(body) }),
  resolve:          (id, body)          => request(`/api/payments/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }),
  autoResolve:      (id)                => request(`/api/payments/${id}/auto-resolve`, { method: "POST", body: JSON.stringify({}) }),
  getAudit:         (id)                => request(`/api/payments/${id}/audit`),
};
