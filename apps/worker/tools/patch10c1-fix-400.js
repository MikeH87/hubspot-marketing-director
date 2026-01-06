const fs = require("fs");

const p = ".\\tools\\ingest-leads-90d.js";
let s = fs.readFileSync(p, "utf8");

// Inject a helper to fetch valid lead property names
if (!s.includes("async function getValidLeadPropertyNames")) {
  s = s.replace(
    "async function postJSON(url, body) {",
    `async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Authorization: \`Bearer \${HUBSPOT_TOKEN}\` } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(\`\${res.status} \${text}\`);
  return json;
}

async function getValidLeadPropertyNames() {
  // Leads properties endpoint (we already proved this works in STEP10A)
  const j = await fetchJSON("https://api.hubapi.com/crm/v3/properties/leads");
  const names = new Set((j.results || []).map(r => r.name));
  return names;
}

async function postJSON(url, body) {`
  );
}

// Replace the hardcoded properties block + filter/sort to use only valid props
// Find the "properties = [...]" block and replace it with dynamic selection.
s = s.replace(
  /const properties = \[[\s\S]*?\];/m,
  `const desired = [
    "hs_createdate",
    "hs_lastmodifieddate",
    "hs_lead_disqualification_reason",
    "hubspot_owner_id",
    "hs_owner_id",
    "hs_lead_status",
    "hs_lead_stage",
    "lead_status",
    "lead_stage"
  ];

  const validNames = await getValidLeadPropertyNames();
  const properties = desired.filter(x => validNames.has(x));

  // Choose a valid "modified date" field for filtering/sorting
  const modifiedFieldCandidates = ["hs_lastmodifieddate", "lastmodifieddate", "hs_lastmodified_date"];
  const modifiedField = modifiedFieldCandidates.find(x => validNames.has(x)) || "hs_lastmodifieddate";
`
);

// Update filter propertyName to use modifiedField
s = s.replace(
  /propertyName: "hs_lastmodifieddate"/g,
  'propertyName: modifiedField'
);

// Update sort propertyName to use modifiedField
s = s.replace(
  /sorts: \[\{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" \}\]/g,
  'sorts: [{ propertyName: modifiedField, direction: "ASCENDING" }]'
);

// Add a tiny progress log per page so it doesn’t feel “stuck”
if (!s.includes("Page fetched:")) {
  s = s.replace(
    "const results = j.results || [];",
    "const results = j.results || [];\n    console.log(`Page fetched: ${results.length} leads (after=${after || 0})`);"
  );
}

fs.writeFileSync(p, s, "utf8");
console.log("PATCH10C1_OK");
