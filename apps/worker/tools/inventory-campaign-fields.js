require("dotenv").config({ path: __dirname + "/../.env" });

const fs = require("fs");
const path = require("path");
const { getAllCampaigns, getCampaignObject } = require("../../../packages/hubspot/client");

function unique(arr) { return Array.from(new Set(arr)); }

(async () => {
  const max = Number(process.env.INVENTORY_MAX || 15);

  const campaigns = await getAllCampaigns(200);
  const sample = campaigns.slice(0, max);

  const out = {
    sampled: sample.length,
    campaign_ids: sample.map(c => c.id),
    top_level_keys: {},
    properties_keys: {},
    examples: []
  };

  for (const c of sample) {
    const obj = await getCampaignObject(c.id);

    const topKeys = Object.keys(obj || {});
    topKeys.forEach(k => out.top_level_keys[k] = (out.top_level_keys[k] || 0) + 1);

    const props = obj && obj.properties ? obj.properties : null;
    if (props && typeof props === "object") {
      Object.keys(props).forEach(k => out.properties_keys[k] = (out.properties_keys[k] || 0) + 1);
    }

    // store 2 small examples (trim big blobs)
    if (out.examples.length < 2) {
      const trimmed = JSON.parse(JSON.stringify(obj));
      if (trimmed?.results?.[0]?.properties) trimmed.results[0].properties = { ...trimmed.results[0].properties };
      out.examples.push(trimmed);
    }
  }

  // Sort counts
  const sortCounts = (m) =>
    Object.fromEntries(Object.entries(m).sort((a,b) => b[1]-a[1]));

  out.top_level_keys = sortCounts(out.top_level_keys);
  out.properties_keys = sortCounts(out.properties_keys);

  const outPath = path.join(process.cwd(), "campaign-field-inventory.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log("Wrote:", outPath);
  console.log("Sampled campaigns:", out.sampled);
  console.log("Top-level keys:", Object.keys(out.top_level_keys).length);
  console.log("Properties keys:", Object.keys(out.properties_keys).length);
})();
