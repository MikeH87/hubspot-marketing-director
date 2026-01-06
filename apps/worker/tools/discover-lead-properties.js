/**
 * Step 10A: Discover Lead properties from HubSpot
 * Outputs likely candidates for:
 * - stage/status
 * - owner
 * - create/update dates
 * - disqualification reason (loss reason)
 */
const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!HUBSPOT_TOKEN) { console.error("Missing HUBSPOT_PRIVATE_APP_TOKEN"); console.log("STEP10A_FAILED"); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${HUBSPOT_TOKEN}` };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}

function pick(name) {
  const n = name.toLowerCase();
  return (
    n.includes("lead") ||
    n.includes("disqual") ||
    n.includes("reason") ||
    n.includes("status") ||
    n.includes("stage") ||
    n.includes("owner") ||
    n.includes("created") ||
    n.includes("updated") ||
    n.includes("closed") ||
    n.includes("lost")
  );
}

async function main() {
  console.log("=== STEP 10A: LEAD PROPERTIES DISCOVERY ===");

  // Try common object name for leads in CRM properties API
  const candidates = [
    "https://api.hubapi.com/crm/v3/properties/leads",
    "https://api.hubapi.com/crm/v3/properties/lead"
  ];

  let props = null;
  let used = null;

  for (const u of candidates) {
    try {
      const j = await fetchJSON(u);
      if (j && j.results) { props = j.results; used = u; break; }
    } catch (e) {
      // keep trying
    }
  }

  if (!props) {
    console.log("Could not load lead properties via crm/v3/properties. Your portal may not expose Leads as a standard object here.");
    console.log("STEP10A_NO_LEADS_OBJECT");
    return;
  }

  console.log("Used endpoint:", used);
  console.log("Total lead properties:", props.length);

  const filtered = props
    .map(p => ({ name: p.name, label: p.label }))
    .filter(p => pick(p.name) || pick(p.label));

  console.log("\n--- Likely relevant lead properties (name → label) ---");
  filtered.slice(0, 80).forEach(p => console.log(`- ${p.name} → ${p.label}`));

  const mustHave = ["hs_lead_disqualification_reason"];
  console.log("\n--- Must-have checks ---");
  for (const m of mustHave) {
    console.log(`${m}: ${props.some(p => p.name === m) ? "FOUND" : "NOT FOUND"}`);
  }

  console.log("\nSTEP10A_OK");
}

main().catch(err => {
  console.error(err.message || err);
  console.log("STEP10A_FAILED");
  process.exit(1);
});
