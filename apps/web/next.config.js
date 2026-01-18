/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@skillrecordings/core',
    '@skillrecordings/sdk',
    '@skillrecordings/database',
  ],
}

export default nextConfig
