import IdentityPortal from './identity-portal';
import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      <nav
        aria-label="Main navigation"
        className="border-b border-emerald-100 bg-white px-5 sm:px-8"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
          <Link
            className="text-lg font-bold tracking-tight text-emerald-900"
            href="/"
          >
            Vendor&apos;s Market
          </Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-semibold">
            <Link
              className="text-slate-700 hover:text-emerald-800"
              href="/marketplace"
            >
              Marketplace
            </Link>
          </div>
        </div>
      </nav>
      <IdentityPortal />
    </>
  );
}
