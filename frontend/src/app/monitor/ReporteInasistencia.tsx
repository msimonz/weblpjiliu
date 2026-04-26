"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import * as XLSX from "xlsx";

type ClassCol = { id: number; name: string };
type ReporteRow = { id: string; name: string; cedula: string | null; counts: number[]; total: number };

type Props = { me: Record<string, unknown> };

export default function ReporteInasistencia({ me }: Props) {
  const course = me?.course as { name?: string } | null;

  const [classes,  setClasses]  = useState<ClassCol[]>([]);
  const [rows,     setRows]     = useState<ReporteRow[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(null);
    apiFetch("/api/monitor/attendance/reporte")
      .then((r: { classes?: ClassCol[]; rows?: ReporteRow[] }) => {
        setClasses(r?.classes || []);
        setRows(r?.rows     || []);
      })
      .catch((e: { message?: string }) => setError(e?.message || "Error cargando reporte"))
      .finally(() => setLoading(false));
  }, []);

  function handleDescargar() {
    if (!rows.length) return;
    const header = ["Curso", "Cédula", "Nombre", ...classes.map((c) => c.name), "Total inasistencias"];
    const data = rows.map((r) => [
      course?.name ?? "—",
      r.cedula ?? "—",
      r.name,
      ...r.counts,
      r.total,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte");
    XLSX.writeFile(wb, `reporte_inasistencia_${course?.name ?? "curso"}.xlsx`);
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0 }}>Reporte de inasistencia</h2>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div className="label">Curso</div>
          <div className="select" style={{ cursor: "default", userSelect: "none", display: "inline-block", minWidth: 160 }}>
            {course?.name ?? "—"}
          </div>
        </div>

        {!loading && rows.length > 0 && (
          <button
            type="button"
            className="btnLight"
            onClick={handleDescargar}
            style={{
              background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
              border: "1px solid rgba(34,197,94,.8)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
              boxShadow: "0 4px 12px rgba(34,197,94,.35)",
              width: 160,
              justifyContent: "center",
            }}
          >
            ↓&nbsp;&nbsp;Descargar&nbsp;
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
              <path d="M4 2h9l5 5v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#fff" stroke="#14532d" strokeWidth="1.2"/>
              <path d="M13 2v5h5" fill="none" stroke="#14532d" strokeWidth="1.2"/>
              <rect x="3" y="10" width="18" height="11" rx="1" fill="#16a34a" stroke="#14532d" strokeWidth="0.8"/>
              <text x="6.5" y="19.5" fontSize="9" fontWeight="bold" fill="#ffffff" fontFamily="Arial, sans-serif">xls</text>
            </svg>
          </button>
        )}
      </div>

      {loading && (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>Cargando reporte...</div>
      )}

      {error && <div className="msgError">{error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>
          No hay registros de asistencia para este curso todavía.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--stroke)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(14,165,233,.08)" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left",   whiteSpace: "nowrap" }}>Curso</th>
                  <th style={{ padding: "10px 12px", textAlign: "left",   whiteSpace: "nowrap" }}>Cédula</th>
                  <th style={{ padding: "10px 12px", textAlign: "left",   whiteSpace: "nowrap" }}>Nombre</th>
                  {classes.map((c) => (
                    <th key={c.id} style={{ padding: "10px 12px", textAlign: "center", whiteSpace: "nowrap", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }} title={c.name}>
                      {c.name}
                    </th>
                  ))}
                  <th style={{ padding: "10px 12px", textAlign: "center", whiteSpace: "nowrap", fontWeight: 700 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--stroke)", background: idx % 2 === 0 ? "transparent" : "rgba(14,165,233,.03)" }}>
                    <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{course?.name ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{r.cedula ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{r.name}</td>
                    {r.counts.map((count, ci) => (
                      <td key={ci} style={{ padding: "8px 12px", textAlign: "center" }}>
                        {count > 0 ? (
                          <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "rgba(239,68,68,.10)", color: "#dc2626" }}>
                            {count}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                    ))}
                    <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700 }}>
                      {r.total > 0 ? (
                        <span style={{ display: "inline-block", padding: "2px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "rgba(239,68,68,.15)", color: "#dc2626" }}>
                          {r.total}
                        </span>
                      ) : (
                        <span style={{ color: "rgba(22,163,74,.9)", fontWeight: 700 }}>0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}
    </div>
  );
}
