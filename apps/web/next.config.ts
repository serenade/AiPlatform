import type { NextConfig } from 'next';

const PLATFORM_API_URL = process.env.PLATFORM_API_URL ?? 'http://localhost:4000';
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL ?? 'http://localhost:8100';

const nextConfig: NextConfig = {
  // 关闭 Next.js 开发模式自带的左下角 DevTools 指示器（非平台界面，避免语言混淆）
  devIndicators: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${PLATFORM_API_URL}/api/:path*` },
      { source: '/agent/:path*', destination: `${AGENT_SERVER_URL}/agent/:path*` },
    ];
  },
};

export default nextConfig;
