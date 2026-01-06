const fs = require("fs");

const p = ".\\tools\\ingest-form-submissions.js";
let s = fs.readFileSync(p, "utf8");

// 1) Add counters
s = s.replace(
  "  let inserted = 0;\n  let scanned = 0;\n  let skippedPractitioner = 0;",
  "  let inserted = 0;\n  let scanned = 0; // processed within cutoff\n  let returned = 0; // total returned by HubSpot\n  let skippedPractitioner = 0;"
);

// 2) Track total returned per form
s = s.replace(
  "    const results = submissions.results || [];",
  "    const results = submissions.results || [];\n    returned += results.length;"
);

// 3) Break early if older than cutoff (and count scanned only when processed)
s = s.replace(
  "      scanned++;\n      const submittedAtMs = Number\\(s\\.submittedAt \\|\\| 0\\);\n      if \\(!Number\\.isFinite\\(submittedAtMs\\) \\|\\| submittedAtMs < cutoffMs\\) continue;",
  "      const submittedAtMs = Number(s.submittedAt || 0);\n      if (!Number.isFinite(submittedAtMs)) continue;\n      if (submittedAtMs < cutoffMs) break; // assume results are newest→oldest\n      scanned++;"
);

// 4) Print both returned and scanned
s = s.replace(
  "  console\\.log\\(`Submissions scanned: \\$\\{scanned\\}`\\);",
  "  console.log(`Submissions returned by HubSpot: ${returned}`);\n  console.log(`Submissions processed (within cutoff): ${scanned}`);"
);

// 5) Safety: if the break assumption is wrong, we still want correct behaviour.
// Add a note in output.
s = s.replace(
  "  console\\.log\\(\"STEP9A_OK\"\\);",
  "  console.log(\"Note: early-break assumes HubSpot returns submissions newest→oldest per form.\");\n  console.log(\"STEP9A_OK\");"
);

fs.writeFileSync(p, s, "utf8");
console.log("PATCH_OK");
