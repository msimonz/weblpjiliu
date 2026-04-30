/** @type {import('next').NextConfig} */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function getGitCommitDateStamp() {
  try {
    return execSync("git show -s --format=%cd --date=format:%Y%m%d%H%M HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function getGitCommitCount() {
  try {
    return execSync("git rev-list --count HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "0";
  }
}

function getPackageMajorMinor() {
  try {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const [major = "0", minor = "0"] = String(packageJson.version || "0.0.0").split(".");
    return `${major}.${minor}`;
  } catch {
    return "0.0";
  }
}

function getBuildVersion() {
  if (process.env.NEXT_PUBLIC_BUILD_VERSION?.trim()) {
    return process.env.NEXT_PUBLIC_BUILD_VERSION.trim();
  }

  return `${getPackageMajorMinor()}.${getGitCommitCount()}`;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_HOSTNAME = SUPABASE_URL
  .replace("https://", "")
  .replace("http://", "")
  .split("/")[0];

const BUILD_VERSION = getBuildVersion();
const COMMIT_DATE_STAMP = process.env.NEXT_PUBLIC_COMMIT_DATE_STAMP || getGitCommitDateStamp();

const nextConfig = {
  output: "export",
  env: {
    NEXT_PUBLIC_BUILD_VERSION: BUILD_VERSION,
    NEXT_PUBLIC_COMMIT_DATE_STAMP: COMMIT_DATE_STAMP,
  },
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

export default nextConfig;
