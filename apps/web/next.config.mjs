import { networkInterfaces } from 'node:os';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Preserve the backend's 10 MiB document limit plus multipart overhead.
    proxyClientMaxBodySize: '11mb',
  },
  allowedDevOrigins: Object.values(networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4')
    .map((address) => address.address),
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.VMARKET_API_PROXY_URL ?? 'http://127.0.0.1:8000'}/api/v1/:path*`,
      },
      {
        source: '/storage/:path*',
        destination: `${process.env.VMARKET_STORAGE_PROXY_URL ?? 'http://localhost:9000'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
