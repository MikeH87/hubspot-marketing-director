require("dotenv").config({ path: __dirname + "/../.env" });
const { hsGet } = require("../../../packages/hubspot/client");

async function main() {
  // Try HubSpot Forms v3 list endpoint (we know this works in many portals)
  const forms = await hsGet("/marketing/v3/forms", { limit: 5 });
  console.log("FORMS_OK", Array.isArray(forms.results) ? forms.results.length : 0);

  // Now try to locate a submissions endpoint (different portals / auth scopes vary)
  // We'll probe a few likely endpoints and report which one works.
  const candidates = [
    { name: "submissions/v3/integration", path: "/submissions/v3/integration/submissions", qs: { limit: 1 } },
    { name: "submissions/v3/submissions", path: "/submissions/v3/submissions", qs: { limit: 1 } },
    { name: "forms/v2/submissions", path: "/forms/v2/submissions/forms", qs: { count: 1 } }
  ];

  for (const c of candidates) {
    try {
      const r = await hsGet(c.path, c.qs);
      console.log("SUBMISSIONS_ENDPOINT_OK", c.name);
      console.log(JSON.stringify(r).slice(0, 500));
      return;
    } catch (e) {
      console.log("SUBMISSIONS_ENDPOINT_FAIL", c.name, "-", e.message);
    }
  }

  console.log("No submissions endpoint succeeded with current token/scopes.");
}

main().catch(e => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
