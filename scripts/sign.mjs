#!/usr/bin/env node
// Signs the extension on addons.mozilla.org via `web-ext sign`.
//
// Credentials are read from MOZILLA_WEB_EXT_API_KEY and
// MOZILLA_WEB_EXT_API_SECRET (environment or a local .env file) and passed to
// web-ext through its own environment variables, so they never show up in the
// process list. Extra arguments are forwarded, e.g. `npm run sign -- --channel=unlisted`.
import { spawn } from "node:child_process";

const key = process.env.MOZILLA_WEB_EXT_API_KEY;
const secret = process.env.MOZILLA_WEB_EXT_API_SECRET;

if (!key || !secret) {
  console.error(
    "Missing AMO credentials.\n" +
      "Set MOZILLA_WEB_EXT_API_KEY and MOZILLA_WEB_EXT_API_SECRET in your environment\n" +
      "or in a .env file in the repository root (see .env.example).",
  );
  process.exit(1);
}

const child = spawn("npx", ["web-ext", "sign", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret },
});
child.on("exit", (code) => process.exit(code ?? 1));
