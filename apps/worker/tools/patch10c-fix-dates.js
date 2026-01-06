const fs = require("fs");

const p = ".\\tools\\ingest-leads-90d.js";
let s = fs.readFileSync(p, "utf8");

// Replace the fragile iso() helper with a safe parser
s = s.replace(
  /function iso\(ms\)\{[\s\S]*?\}/m,
  `function toIso(val, fallbackIso) {
  if (val === undefined || val === null) return fallbackIso;
  // If it's already an ISO-ish string, try it directly
  if (typeof val === "string" && val.includes("T")) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? fallbackIso : d.toISOString();
  }
  // Try numeric epoch millis
  const n = Number(val);
  if (!Number.isFinite(n)) return fallbackIso;
  const d = new Date(n);
  return isNaN(d.getTime()) ? fallbackIso : d.toISOString();
}`
);

// Update the two call sites (created_at / updated_at) to use toIso(...)
s = s.replace(
  /const created_at = p\.hs_createdate \? iso\(Number\(p\.hs_createdate\)\) : \(r\.createdAt \|\| iso\(Date\.now\(\)\)\);/g,
  `const created_at = toIso(p.hs_createdate, (r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString()));`
);

s = s.replace(
  /const updated_at = p\.hs_lastmodifieddate \? iso\(Number\(p\.hs_lastmodifieddate\)\) : \(r\.updatedAt \|\| iso\(Date\.now\(\)\)\);/g,
  `const updated_at = toIso(p.hs_lastmodifieddate, (r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString()));`
);

fs.writeFileSync(p, s, "utf8");
console.log("PATCH10C_OK");
