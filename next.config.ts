import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["tbd.saltbox.cc"],
  serverExternalPackages: ["@ffprobe-installer/ffprobe", "ffmpeg-static"],
};

export default nextConfig;
