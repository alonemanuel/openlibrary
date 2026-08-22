// The Worker is the only TypeScript in the repo. The page (worker/public/) is
// hand-written HTML with an inline script and the pipeline is Python, so
// neither is linted here — recommended rules only, to catch real mistakes.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.wrangler/**', '**/*.html', 'pipeline/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // D1 rows legitimately round-trip through unknown; require explicit
      // intent instead of banning the escape hatch outright.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
