import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/whatsapp/:path*',
        destination: 'http://localhost:5000/api/whatsapp/:path*',
      },
    ];
  },
};

export default nextConfig;
