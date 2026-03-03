/** @type {import('next').NextConfig} */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_HOSTNAME = SUPABASE_URL
  .replace("https://", "")
  .replace("http://", "")
  .split("/")[0];

const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
    remotePatterns: SUPABASE_HOSTNAME
      ? [
          {
            protocol: "https",
            hostname: SUPABASE_HOSTNAME,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

module.exports = nextConfig;