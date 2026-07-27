/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Allow a 4 MiB file plus multipart overhead without advertising beyond Vercel's ceiling.
      bodySizeLimit: '4.5mb',
    },
  },
};

export default nextConfig;
