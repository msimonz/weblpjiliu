export default function Footer({
  leftText = "© 2026 SOFIA · La Promesa",
  rightText = "",
}: {
  leftText?: string;
  rightText?: string;
}) {
  const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION?.trim();
  const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim();
  const versionText = [
    buildVersion ? `v${buildVersion}` : "",
    commitSha || "",
  ].filter(Boolean).join(" · ");
  const displayLeftText = versionText ? `${leftText} · ${versionText}` : leftText;

  return (
    <footer
      style={{
        marginTop: 28,
        padding: "18px 0",
        borderTop: "1px solid var(--stroke)",
        color: "var(--footer)",
      }}
    >
      <div
        className="container"
        style={{
          paddingTop: 0,
          paddingBottom: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 8, fontWeight: 700 }}>{displayLeftText}</div>
        <div style={{ fontSize: 8, fontWeight: 700 }}>{rightText}</div>
      </div>
    </footer>
  );
}
