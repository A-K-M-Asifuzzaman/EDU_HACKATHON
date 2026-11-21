import type { NextConfig } from "next";

// Static export: the FastAPI service serves frontend/out on a single port (production).
// In `next dev` the client calls the API directly (NEXT_PUBLIC_API_BASE, default http://127.0.0.1:8000).
const config: NextConfig = { output: "export", trailingSlash: true, images: { unoptimized: true }, reactStrictMode: true };
export default config;
