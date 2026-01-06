const fs = require("fs");

const p = ".\\tools\\ingest-form-submissions.js";
let s = fs.readFileSync(p, "utf8");

// Ensure counters exist
if (!s.includes("let returned")) {
  s = s.replace("let inserted = 0;", "let inserted = 0;\n  let returned = 0; // total returned by HubSpot");
}
if (!s.includes("let processed")) {
  s = s.replace("let returned = 0; // total returned by HubSpot", "let returned = 0; // total returned by HubSpot\n  let processed = 0; // within cutoff");
}

// Ensure we increment returned per form call
if (!s.includes("returned += results.length")) {
  s = s.replace(
    "const results = submissions.results || [];",
    "const results = submissions.results || [];\n    returned += results.length;"
  );
}

// Ensure we increment processed only when within cutoff (keep existing logic, just count)
if (!s.includes("processed++")) {
  s = s.replace(
    "scanned++;",
    "scanned++;\n      processed++;"
  );
}

// Replace the console lines to print both metrics (regardless of previous wording)
s = s.replace(
  /console\.log\(`Submissions scanned: \$\{scanned\}`\);\s*/g,
  "console.log(`Submissions returned by HubSpot: ${returned}`);\n  console.log(`Submissions processed (within cutoff): ${processed}`);\n"
);

// If the old line is missing, insert our two lines before Rows-in-DB line
if (!s.includes("Submissions returned by HubSpot")) {
  s = s.replace(
    "console.log(`Rows in DB within window: ${verify.rows[0].c}`);",
    "console.log(`Submissions returned by HubSpot: ${returned}`);\n  console.log(`Submissions processed (within cutoff): ${processed}`);\n  console.log(`Rows in DB within window: ${verify.rows[0].c}`);"
  );
}

fs.writeFileSync(p, s, "utf8");
console.log("PATCH9H_OK");
