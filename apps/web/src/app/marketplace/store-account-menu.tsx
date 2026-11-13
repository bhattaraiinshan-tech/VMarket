'use client';

import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace-context';
import {
  availableWorkspaces,
  selectWorkspace,
  type Workspace,
} from '@/lib/workspace-state';

export default function StoreAccountMenu() {
  const { user, workspace } = useWorkspace();
  if (!user || workspace !== 'customer') {
    return (
      <Link className="py-3 hover:underline" href="/">
        Account
      </Link>
    );
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer py-3">Account</summary>
      <div className="absolute right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2.5rem)] rounded border border-gray-200 bg-white p-4 text-left text-xs normal-case tracking-normal text-gray-950 shadow-lg">
        <label className="block font-semibold">
          Workspace
          <select
            aria-label="Workspace"
            className="mt-2 w-full border border-gray-300 bg-white p-2 font-normal"
            value={workspace}
            onChange={(event) =>
              selectWorkspace(event.target.value as Workspace)
            }
          >
            {availableWorkspaces(user).map((mode) => (
              <option key={mode} value={mode}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 grid gap-1 border-t border-gray-200 pt-2">
          {[
            ['/', 'Your account'],
            ['/orders', 'Customer orders'],
            ['/messages', 'Messages'],
            ['/notifications', 'Notifications'],
            ['/support', 'Support and disputes'],
          ].map(([href, label]) => (
            <Link className="py-2 hover:underline" href={href} key={href}>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </details>
  );
}
