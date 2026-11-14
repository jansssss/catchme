/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["web-push", "@electric-sql/pglite"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};
export default nextConfig;
