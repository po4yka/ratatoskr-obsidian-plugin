import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(root, "openapi", "openapi.json");
const lockPath = join(root, "openapi", "openapi.lock.json");
const generatedPath = join(root, "src", "api", "generated", "schema.ts");
const generatorBin = join(root, "node_modules", ".bin", "openapi-typescript");

// Digest first: a trailing-newline edit regenerates to identical output, so a
// byte-compare alone cannot see every mutation of the pinned document.
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const actualDigest = createHash("sha256")
  .update(readFileSync(contractPath))
  .digest("hex");
if (actualDigest !== lock.digest) {
  console.error(
    `The pinned contract no longer matches its lock.\n  expected: ${lock.digest}\n  actual:   ${actualDigest}\n  contract: openapi/openapi.json\n  lock:     openapi/openapi.lock.json`,
  );
  process.exit(1);
}

let failed = false;
const tempDir = mkdtempSync(join(tmpdir(), "ratatoskr-api-check-"));
try {
  const freshPath = join(tempDir, "schema.ts");
  const gen = spawnSync(generatorBin, [contractPath, "-o", freshPath], {
    encoding: "utf8",
  });
  if (gen.status !== 0) {
    console.error(`Regeneration failed:\n${gen.stderr}`);
    failed = true;
  } else if (!readFileSync(generatedPath).equals(readFileSync(freshPath))) {
    console.error(
      `Generated types drifted from the pinned contract.\n  committed module: src/api/generated/schema.ts\n  regenerated from: openapi/openapi.json\nRun npm run api:gen and commit the regenerated module.`,
    );
    failed = true;
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exit(1);
}
console.log("API types match the pinned contract.");
