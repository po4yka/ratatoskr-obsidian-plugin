import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ci.yml and DEVELOPMENT.md are one list. ci.yml checks the pair before any test runs; this test
// checks it again from inside the suite, so `npm run test` on a laptop also reports the drift.
function ciCommands(): string[] {
  return readFileSync('.github/workflows/ci.yml', 'utf8')
    .split('\n')
    .filter((line) => /^\s+- run: npm run /.test(line))
    .map((line) => line.replace(/^\s+- run: /, '').trim());
}

function documentedCommands(): string[] {
  const text = readFileSync('DEVELOPMENT.md', 'utf8');
  const start = text.indexOf('The gate runs these commands:');
  const block = text.slice(start).split('```bash\n')[1]?.split('```')[0] ?? '';
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('npm run '));
}

describe('the gate', () => {
  it('lists the same commands in ci.yml and DEVELOPMENT.md', () => {
    expect(ciCommands().length).toBeGreaterThan(0);
    expect(documentedCommands()).toEqual(ciCommands());
  });
});
