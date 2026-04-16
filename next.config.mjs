/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Vercel's file-trace output strips anything that isn't reachable via
    // static `import`. Our PDF renderer loads Noto Sans Hebrew from disk
    // at runtime, so explicitly include the fonts directory for every
    // route that generates statements. (Next 14 keeps this flag under
    // `experimental`; it moved to the top level in Next 15.)
    outputFileTracingIncludes: {
      "/api/email/pdf": ["./fonts/**/*"],
      "/api/email/send": ["./fonts/**/*"],
      "/api/email/test": ["./fonts/**/*"],
      "/api/email/cron": ["./fonts/**/*"],
    },
  },
};

export default nextConfig;
