// Compiles the sample policy text with the configured LLM and prints the rules and their diff from DEFAULT_POLICY.
// Run: npm run spike scripts/spikes/policy-compile.ts
import { compilePolicy, diffPolicy, SAMPLE_POLICY_TEXT } from "../../src/policy/compiler";
import { DEFAULT_POLICY } from "../../src/policy/schema";

const started = Date.now();
const policy = await compilePolicy(SAMPLE_POLICY_TEXT, 2);
const diff = diffPolicy(DEFAULT_POLICY, policy);
console.log(JSON.stringify(policy, null, 2));
console.log(`${diff.length ? "DIFF" : "PASS"}: ${diff.length} difference(s) from DEFAULT_POLICY in ${((Date.now() - started) / 1000).toFixed(1)}s`);
for (const c of diff) console.log(`  ${c.path}: ${c.from} -> ${c.to}`);
