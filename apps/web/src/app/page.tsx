import IdentityPortal from './identity-portal';
import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 sm:px-8">
        <Link className="font-bold text-emerald-800" href="/">
          Vendor&apos;s Market
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold">
          <Link
            className="text-slate-700 hover:text-emerald-800"
            href="/marketplace"
          >
            Marketplace
          </Link>
          <Link
            className="text-slate-700 hover:text-emerald-800"
            href="/vendor"
          >
            Vendor workspace
          </Link>
          <Link className="text-slate-700 hover:text-emerald-800" href="/cart">
            Cart
          </Link>
          <Link
            className="text-slate-700 hover:text-emerald-800"
            href="/orders"
          >
            Orders
          </Link>
          <Link
            className="text-slate-700 hover:text-emerald-800"
            href="/notifications"
          >
            Notifications
          </Link>
        </div>
      </nav>
      <IdentityPortal />
    </>
  );
}
