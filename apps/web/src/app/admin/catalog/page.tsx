import Link from 'next/link';

import AdminCatalog from './admin-catalog';

export default function AdminCatalogPage() {
  return (
    <>
      <nav className="mx-auto flex max-w-7xl justify-end px-5 pt-5 text-sm font-semibold text-emerald-800 sm:px-8">
        <Link href="/admin/communications">Reviews and support queue</Link>
      </nav>
      <AdminCatalog />
    </>
  );
}
