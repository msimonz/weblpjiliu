import type { CSSProperties } from "react";

const DEFAULT_PREFIX = "\u00a9 2026 SOFIA \u00b7 La Promesa";
const SEPARATOR = " \u00b7 ";

export default function AppVersionLabel({
  prefix = DEFAULT_PREFIX,
  className,
  style,
}: {
  prefix?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION?.trim();
  const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim();
  const versionText = [
    buildVersion ? `v${buildVersion}` : "",
    commitSha || "",
  ].filter(Boolean).join(SEPARATOR);
  const displayText = versionText ? `${prefix}${SEPARATOR}${versionText}` : prefix;

  return (
    <span className={className} style={style}>
      {displayText}
    </span>
  );
}
