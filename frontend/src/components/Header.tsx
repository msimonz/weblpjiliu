import Image from "next/image";

export default function Header({
  userLabel,
  onLogout,
  logoUrl,
  titleRight,
}: {
  userLabel?: string;
  onLogout?: () => void;
  logoUrl?: string;      // ✅ logo dinámico (Supabase public url)
  titleRight?: string;   // ✅ texto a la derecha del separador (ej: "JILIU")
}) {
  return (
    <header
      className="topbar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 80,
        background: "var(--card)",
        borderBottom: "1px solid var(--stroke)",
        boxShadow: "var(--shadow)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: "var(--text)",
      }}
    >
      <div
        className="container topbar-inner"
        style={{
          paddingTop: 14,
          paddingBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        {/* IZQUIERDA: logo (bucket) + | + texto */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {logoUrl ? (
            // ✅ logo desde URL pública (no Next/Image para evitar config de domains)
            <img
              src={logoUrl}
              alt="logo"
              style={{ height: 42, width: "auto", objectFit: "contain" }}
            />
          ) : (
            // fallback si no pasas logoUrl
            <Image src="/logo.png" alt="JILIU" width={34} height={34} />
          )}

          <div
            style={{
              width: 1,
              height: 32,
              background: "color-mix(in srgb, var(--text) 18%, transparent)",
              borderRadius: 999,
            }}
          />

          <div style={{ fontWeight: 950, fontSize: 18, letterSpacing: "-0.01em" }}>
            {titleRight ?? "JILIU"}
          </div>
        </div>

        {/* DERECHA: badge + logout (si aplica) */}
        <div className="row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {userLabel ? (
            <span
              className="badge"
              style={{
                background: "var(--card)",
                border: "1px solid var(--stroke)",
                color: "var(--text)",
                boxShadow: "var(--shadow)",
                padding: "8px 12px",
                borderRadius: 999,
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              {userLabel}
            </span>
          ) : null}

          {onLogout ? (
            <button className="btnLight" onClick={onLogout}>
              Salir
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
