import type { NextConfig } from "next";

const basePath = process.env.GITHUB_PAGES ? (process.env.BASE_PATH ?? "") : "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  agentRules: false,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_BUILD_SHA: (process.env.BUILD_SHA ?? "dev").slice(0, 7),
    NEXT_PUBLIC_VERSION: process.env.npm_package_version ?? "0.0.0",
  },
};

export default nextConfig;
