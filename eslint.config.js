// One config for the whole workspace: server, web client and the music Worker.
// Recommended rule sets only — the point is catching real mistakes, not
// imposing a style the type checker and existing conventions already cover.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'music-library/**/*.html'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The API layer and D1 rows legitimately round-trip through unknown;
      // require explicit intent instead of banning the escape hatch outright.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Tests assert against parsed JSON bodies; `any` is the honest type there.
    files: ['server/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // The two classic rules only. v7's full recommended set also bans
    // setState inside effects, which is exactly how this app loads data —
    // adopt those rules if the fetching ever moves to a data library.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
