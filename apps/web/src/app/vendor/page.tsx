import Link from 'next/link';

import VendorCatalogue from './vendor-catalogue';

export default function VendorPage() {
  return (
    <>
      <nav className="mx-auto flex max-w-7xl justify-end gap-4 px-5 pt-5 text-sm font-semibold text-emerald-800 sm:px-8">
        <Link href="/messages">Customer messages</Link>
        <Link href="/vendor/reviews">Product reviews</Link>
        <Link href="/vendor/trade">Wholesale and vendor trade</Link>
      </nav>
      <VendorCatalogue />
    </>
  );
}
