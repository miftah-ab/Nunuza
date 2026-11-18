#!/usr/bin/env node
/**
 * Production dependency audit gate.
 *
 * Fails on any high or critical advisory in production dependencies, except the
 * advisories listed below. An exception must name why it is safe and be removed
 * once a fixed version exists. Any other (new) advisory still fails CI.
 */
import { execFileSync } from "node:child_process";

const ALLOWED = {
  // picomatch ReDoS via repeated extglobs. No patched version exists yet. It is
  // reached only through build-time tooling (tailwindcss, chokidar, micromatch)
  // that never receives user-controlled glob patterns, and is not shipped in the
  // Worker bundle. Remove when picomatch publishes a fix.
  "GHSA-fc5q-39xc-vjpf": "picomatch ReDoS, build-time only, no fix available",
};

export function findBlockingAdvisories(report, allowed = ALLOWED) {
  const blocking = new Map();
  for (const [pkg, vuln] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || !via) continue;
      if (via.severity !== "high" && via.severity !== "critical") continue;
      const id = String(via.url ?? "").split("/").pop() || String(via.source);
      if (allowed[id]) continue;
      blocking.set(id, `${pkg}: ${via.title} (${via.severity}) ${via.url ?? ""}`);
    }
  }
  return [...blocking.values()];
}

function main() {
  let output;
  try {
    output = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the report is on stdout.
    output = error.stdout?.toString() ?? "";
    if (!output.trim()) {
      console.error("npm audit produced no report:", error.message);
      process.exit(1);
    }
  }
  const blocking = findBlockingAdvisories(JSON.parse(output));
  if (blocking.length > 0) {
    console.error("Blocking high or critical advisories in production dependencies:");
    for (const line of blocking) console.error(" - " + line);
    process.exit(1);
  }
  console.log("Production dependency audit passed (allowlisted advisories: " + Object.keys(ALLOWED).join(", ") + ").");
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
