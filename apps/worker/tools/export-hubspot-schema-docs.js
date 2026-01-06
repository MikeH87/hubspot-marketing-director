const fs = require("fs");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error("Missing " + name);
  return v;
}

const TOKEN = need("HUBSPOT_PRIVATE_APP_TOKEN");
const BASE = "https://api.hubapi.com";

async function hsGet(path) {
  const resp = await fetch(BASE + path, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HubSpot GET failed ${resp.status}: ${text.slice(0, 2000)}`);
  }
  return JSON.parse(text);
}

function mdEscape(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function dumpProperties(objectType) {
  // v3 properties endpoint
  // objectType: "contacts" | "deals" | "leads"
  const json = await hsGet(`/crm/v3/properties/${objectType}`);
  // Normalise a “useful” subset to keep the doc readable
  const props = (json.results || []).map(p => ({
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    groupName: p.groupName,
    description: p.description,
    hidden: p.hidden,
    readOnly: p.readOnlyValue,
  }));

  props.sort((a,b) => (a.groupName || "").localeCompare(b.groupName || "") || a.name.localeCompare(b.name));

  let md = `## ${objectType.toUpperCase()} properties\n\n`;
  md += `| Internal name | Label | Type | Field type | Group | Hidden | Read-only | Description |\n`;
  md += `|---|---|---|---|---|---:|---:|---|\n`;

  for (const p of props) {
    md += `| ${mdEscape(p.name)} | ${mdEscape(p.label)} | ${mdEscape(p.type)} | ${mdEscape(p.fieldType)} | ${mdEscape(p.groupName)} | ${p.hidden ? "yes" : "no"} | ${p.readOnly ? "yes" : "no"} | ${mdEscape(p.description)} |\n`;
  }
  md += `\n\n`;
  return md;
}

async function dumpPipelines(objectType) {
  // v3 pipelines endpoint
  // objectType: "deals" | "leads"
  const json = await hsGet(`/crm/v3/pipelines/${objectType}`);
  const pipes = json.results || [];

  let md = `## ${objectType.toUpperCase()} pipelines\n\n`;
  for (const p of pipes) {
    md += `### ${p.label}\n`;
    md += `- Pipeline ID: \`${p.id}\`\n`;
    md += `- Stages: ${p.stages?.length || 0}\n\n`;
    md += `| Stage label | Stage ID | Display order | Metadata |\n`;
    md += `|---|---|---:|---|\n`;
    for (const s of (p.stages || [])) {
      md += `| ${mdEscape(s.label)} | \`${mdEscape(s.id)}\` | ${s.displayOrder ?? ""} | ${mdEscape(JSON.stringify(s.metadata || {}))} |\n`;
    }
    md += `\n`;
  }
  md += `\n`;
  return md;
}

async function main() {
  // Properties
  let propsMd = `# HubSpot Useful Properties Dump\n\nGenerated: ${new Date().toISOString()}\n\n`;
  propsMd += await dumpProperties("contacts");
  propsMd += await dumpProperties("leads");
  propsMd += await dumpProperties("deals");
  fs.writeFileSync("../HUBSPOT_PROPERTIES_DUMP.md", propsMd, "utf8");

  // Pipelines
  let pipesMd = `# HubSpot Pipelines Dump\n\nGenerated: ${new Date().toISOString()}\n\n`;
  pipesMd += await dumpPipelines("leads");
  pipesMd += await dumpPipelines("deals");
  fs.writeFileSync("../HUBSPOT_PIPELINES_DUMP.md", pipesMd, "utf8");

  console.log("WROTE_OK");
  console.log(" - ../HUBSPOT_PROPERTIES_DUMP.md");
  console.log(" - ../HUBSPOT_PIPELINES_DUMP.md");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
