export interface BenchCase {
  prompt: string;
  /** Expected top skill, or null when nothing should match. */
  expected: string | null;
  /** True when the prompt deliberately avoids the description's wording. */
  paraphrase?: boolean;
  /** True when the prompt shares little vocabulary with the description, so routing must infer. */
  hard?: boolean;
}

export const CASES: BenchCase[] = [
  { prompt: "my test suite is red after the last change", expected: "failing-test-triage" },
  { prompt: "this test's assertion keeps blowing up and I cannot see why", expected: "failing-test-triage", paraphrase: true },
  { prompt: "pull the line items and totals out of this scanned bill", expected: "invoice-line-extraction" },
  { prompt: "extract the dates and totals from this invoice document", expected: "invoice-line-extraction" },
  { prompt: "grab the fields off these receipts for me", expected: "invoice-line-extraction", paraphrase: true },
  { prompt: "the invoice total does not match our ledger entries", expected: "invoice-reconciliation" },
  { prompt: "chase down a payment discrepancy from last month", expected: "invoice-reconciliation" },
  { prompt: "recalibrate the widget sensor tolerance", expected: "widget-sensor-calibration" },
  { prompt: "reset the device baseline before shipment", expected: "widget-sensor-calibration" },
  { prompt: "the widget's sensor tolerances need adjusting before shipment", expected: "widget-sensor-calibration", paraphrase: true },
  { prompt: "design a banner for the spring campaign", expected: "banner-artwork" },
  { prompt: "I need promotional artwork for social", expected: "banner-artwork" },
  { prompt: "cut a release and write the release notes", expected: "release-checklist" },
  { prompt: "tagging version 2.1 before shipping", expected: "release-checklist" },
  { prompt: "adding columns to the accounts table", expected: "schema-migration" },
  { prompt: "run the database migration scripts to add this new field", expected: "schema-migration" },
  { prompt: "altering the table structure with a database migration", expected: "schema-migration", paraphrase: true },
  { prompt: "this test passes locally but fails in CI at random", expected: "flaky-test-quarantine" },
  { prompt: "this test intermittently fails in our CI pipeline but passes locally every time", expected: "flaky-test-quarantine", paraphrase: true },
  { prompt: "take a look at ABC-1234 and triage it", expected: "ticket-intake" },
  { prompt: "triage this reported issue for me", expected: "ticket-intake" },
  { prompt: "we are changing the response payload of the search endpoint", expected: "api-contract-review" },
  { prompt: "version the public interface before clients break", expected: "api-contract-review", paraphrase: true },
  { prompt: "search production logs for the cause of the outage", expected: "log-forensics" },
  { prompt: "there was an error spike at 3am, find out why", expected: "log-forensics" },
  { prompt: "we are seeing timeouts, dig through the production logs to find the cause", expected: "log-forensics", paraphrase: true },
  { prompt: "how do I run this project for the first time", expected: "onboarding-walkthrough" },
  { prompt: "new contributor needs the local setup path", expected: "onboarding-walkthrough" },
  { prompt: "review this vulnerability advisory before we bump the version", expected: "dependency-audit" },
  { prompt: "we are adding a third party library for parsing", expected: "dependency-audit" },
  { prompt: "tighten this prose and fix the tone", expected: "copy-editing" },
  { prompt: "rewrite the documentation for clarity", expected: "copy-editing" },
  { prompt: "clean up the prose in this README for clarity", expected: "copy-editing", paraphrase: true },
  { prompt: "what is the capital of France", expected: null },
  { prompt: "hello", expected: null },
  { prompt: "thanks, that worked", expected: null },
  { prompt: "can you order me a coffee", expected: null },

  // Hard positives: little or no shared vocabulary with the target description.
  { prompt: "the build is green on my machine but red on the server", expected: "flaky-test-quarantine", hard: true },
  { prompt: "customers said the site was unreachable around midnight, work out what happened", expected: "log-forensics", hard: true },
  { prompt: "make the wording in this guide snappier", expected: "copy-editing", hard: true },
  { prompt: "we need to add a field to store the customer's phone number", expected: "schema-migration", hard: true },
  { prompt: "somebody needs to check this package is safe before we pull it in", expected: "dependency-audit", hard: true },
  { prompt: "the numbers in the statement and our books disagree", expected: "invoice-reconciliation", hard: true },

  // Hard negatives: plausible engineering prompts that no skill in this corpus covers.
  { prompt: "refactor this react component into smaller pieces", expected: null },
  { prompt: "set up a kubernetes ingress for the staging cluster", expected: null },
  { prompt: "convert these callbacks to async await", expected: null },
  { prompt: "explain what this regular expression matches", expected: null },
  { prompt: "why is my css grid overlapping on mobile", expected: null },
  { prompt: "what is the time complexity of this loop", expected: null },
];
