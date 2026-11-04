import { defineConfig, globalIgnores } from 'eslint/config';
import nextTypescript from 'eslint-config-next/typescript';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
  ]),
]);
