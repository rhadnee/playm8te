// Generates public/config.js from environment variables at deploy-build
// time. This is the "appropriate configuration approach" for a plain
// HTML/JS frontend (no bundler/Vite/React) — Netlify's build step runs
// `node scripts/generate-frontend-config.js` (see netlify.toml), reading
// API_URL / WS_URL from Netlify's own environment variable settings, and
// writes a small config file the static page loads before its own script.
//
// Local development default: empty string for both, meaning "same origin
// as whatever served this page" — this preserves the existing behavior
// where Express serves both the API and public/index.html from one
// process on localhost, with zero configuration needed.
const fs = require("fs");
const path = require("path");

const apiUrl = process.env.API_URL || "";
const wsUrl = process.env.WS_URL || "";

const contents = `// Auto-generated at build time by scripts/generate-frontend-config.js — do not edit by hand.
window.PLAYM8TE_CONFIG = {
  API_URL: ${JSON.stringify(apiUrl)},
  WS_URL: ${JSON.stringify(wsUrl)},
};
`;

const outPath = path.join(__dirname, "..", "public", "config.js");
fs.writeFileSync(outPath, contents);
console.log(`Wrote ${outPath}`);
console.log(`  API_URL: ${apiUrl || "(empty — same-origin default)"}`);
console.log(`  WS_URL: ${wsUrl || "(empty — same-origin default)"}`);
