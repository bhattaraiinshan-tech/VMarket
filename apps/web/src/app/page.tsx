import Link from 'next/link';

const platformSurfaces = [
  {
    title: 'Customer marketplace',
    description: 'Discover shops and products from one place.',
  },
  {
    title: 'Vendor workspace',
    description: 'A home for shops, suppliers, and business buyers.',
  },
  {
    title: 'Administrator console',
    description: 'Tools for operating a safe and trusted marketplace.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 sm:px-10">
      <header className="flex items-center justify-between">
        <Link className="text-lg font-bold tracking-tight" href="/">
          Vendor&apos;s Market
        </Link>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
          Project foundation
        </span>
      </header>

      <section className="flex flex-1 flex-col justify-center py-16">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Built for business in Nepal
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          One market for customers, shops, and suppliers.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Vendor&apos;s Market brings retail and wholesale commerce together.
          The platform foundation is in place; marketplace workflows will be
          introduced in upcoming phases.
        </p>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {platformSurfaces.map((surface) => (
            <article
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              key={surface.title}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Coming in a later phase
              </p>
              <h2 className="mt-4 text-lg font-semibold">{surface.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {surface.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 pt-5 text-sm text-slate-500">
        A shared marketplace for Nepal&apos;s businesses.
      </footer>
    </main>
  );
}
