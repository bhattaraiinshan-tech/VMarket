import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Vendor's Market",
  description:
    'A commerce platform for customers, shops, and suppliers in Nepal.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* Browser extensions such as Grammarly inject body attributes before hydration. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
