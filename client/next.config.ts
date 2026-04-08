import type { NextConfig } from "next";

const backendApiUrl =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:5000/api';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendApiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
