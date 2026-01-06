require("dotenv").config({ path: __dirname + "/../.env" });
const { hsGet } = require("../../../packages/hubspot/client");

async function main() {
  // 1) Get one real form id from your portal
  const forms = await hsGet("/marketing/v3/forms", { limit: 1 });
  const f = (forms && Array.isArray(forms.results) && forms.results[0]) ? forms.results[0] : null;
  if (!f) throw new Error("No forms returned from /marketing/v3/forms");

  const formId = String(f.id);
  const formName = String(f.name || "");
  console.log("FORM_PICKED:", formId, "-", formName);

  // 2) Probe the legacy submissions read endpoint (this is the common one)
  const candidates = [
    { name: "form-integrations v1 (count)", path: `/form-integrations/v1/submissions/forms/${formId}`, qs: { count: 1 } },
    { name: "form-integrations v1 (limit)", path: `/form-integrations/v1/submissions/forms/${formId}`, qs: { limit: 1 } },
    { name: "form-integrations v1 (no qs)", path: `/form-integrations/v1/submissions/forms/${formId}`, qs: {} },
  ];

  for (const c of candidates) {
    try {
      const r = await hsGet(c.path, c.qs);
      console.log("SUBMISSIONS_OK:", c.name);
      console.log(JSON.stringify(r).slice(0, 800));
      return;
    } catch (e) {
      console.log("SUBMISSIONS_FAIL:", c.name, "-", e.message);
    }
  }

  console.log("No submissions endpoint worked for that formId.");
}

main().catch(e => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
