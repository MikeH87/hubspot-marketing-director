require("dotenv").config({ path: __dirname + "/../.env" });
const { hsGet } = require("../../../packages/hubspot/client");

async function main() {
  // This endpoint returns the scopes granted to the token
  const j = await hsGet("/oauth/v1/access-tokens/" + process.env.HUBSPOT_PRIVATE_APP_TOKEN);
  console.log("SCOPES:", (j && j.scopes) ? j.scopes : j);
}

main().catch(e => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
