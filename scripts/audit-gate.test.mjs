import { findBlockingAdvisories } from "./audit-gate.mjs";
import assert from "node:assert/strict";

const report = (via) => ({ vulnerabilities: { pkg: { via } } });
const picomatch = { severity: "high", title: "picomatch ReDoS", url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf" };
const other = { severity: "high", title: "Something new", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" };
const moderate = { severity: "moderate", title: "minor", url: "https://github.com/advisories/GHSA-mmmm-mmmm-mmmm" };

assert.deepEqual(findBlockingAdvisories(report([picomatch])), []);
assert.equal(findBlockingAdvisories(report([picomatch, other])).length, 1);
assert.deepEqual(findBlockingAdvisories(report([moderate, "indirect-package"])), []);
assert.equal(findBlockingAdvisories(report([{ ...other, severity: "critical" }])).length, 1);
console.log("audit-gate tests passed");
