export default function Footer({
  leftText = "© 2026 SOFIA · La Promesa",
  rightText = "",
}: {
  leftText?: string;
  rightText?: string;
}) {
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
        <div style={{ fontSize: 8, fontWeight: 700 }}>{leftText}</div>
        <div style={{ fontSize: 8, fontWeight: 700 }}>{rightText}</div>
      </div>
    </footer>
  );
}
