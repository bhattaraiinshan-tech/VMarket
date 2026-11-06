import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setWorkspaceUser } from './lib/workspace-state';

afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  sessionStorage.clear();
});
