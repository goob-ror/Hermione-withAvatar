/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Drives the operator's installed Chrome at runtime — never bundle it.
  serverExternalPackages: ['playwright-core'],
}

export default nextConfig
