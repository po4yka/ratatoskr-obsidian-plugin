import js from '@eslint/js';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Size limits are the fleet TypeScript standard from ratatoskr-workspace/docs/QUALITY_GATES.md
// (the same block as ratatoskr-browser-extension/eslint.config.js). Every number is severity
// error, so a finding fails the gate. Raising one is a documented measurement, never a silent bump.
const sizeLimits = {
  rules: {
    'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
    complexity: ['error', 8],
    'max-params': ['error', 2],
  },
};

export default tseslint.config(
  // `src/api/generated/` is generator output: `npm run api:check` owns it, and an edit there is
  // overwritten by the next `npm run api:gen`. `main.js` is the build output.
  globalIgnores(['node_modules/', 'main.js', 'src/api/generated/', 'coverage/']),
  js.configs.recommended,
  ...tseslint.configs.strict,
  sizeLimits,
  {
    // Plain Node scripts: not type-checked, so they need real global declarations.
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: { globals: globals.node },
  },
);
