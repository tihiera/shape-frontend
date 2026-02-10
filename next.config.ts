import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  env: {
    NEXT_PUBLIC_BACKEND: process.env.BACKEND || "",
  },
};

export default nextConfig;

