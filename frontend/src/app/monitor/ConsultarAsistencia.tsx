"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import * as XLSX from "xlsx";

const MESES = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function fmtFecha(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${MESES[Number(m) - 1]}-${y}`;
}

type ModuleItem  = { id: number; name: string };
type ClassItem   = { id: number; name: string };
type SesionFecha = { id: number; fecha_clase: string };
type DetalleRow  = { id_student: string; name: string | null; cedula: string | null; asistio: boolean; motivo: string };
type SesionInfo  = { id: number; id_teacher: string; profesor_asistio: boolean; profesor_reemplazo: string | null; teacher_name: string | null };

type Props = { me: Record<string, unknown> };

export default function ConsultarAsistencia({ me }: Props) {
  const course = me?.course as { id: number; name: number; year: number } | null;

  const [modules,  setModules]  = useState<ModuleItem[]>([]);
  const [classes,  setClasses]  = useState<ClassItem[]>([]);
  const [fechas,   setFechas]   = useState<SesionFecha[]>([]);
  const [detalle,  setDetalle]  = useState<DetalleRow[]>([]);
  const [sesion,   setSesion]   = useState<SesionInfo | null>(null);

  const [moduleId, setModuleId] = useState("");
  const [classId,  setClassId]  = useState("");
  const [fecha,    setFecha]    = useState("");

  const [loadingFechas,  setLoadingFechas]  = useState(false);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  // Carga módulos al montar
  useEffect(() => {
    apiFetch("/api/monitor/modules")
      .then((r: { items?: ModuleItem[] }) => setModules(r?.items || []))
      .catch(() => {});
  }, []);

  // Módulo → materias
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClassId(""); setFecha(""); setFechas([]); setDetalle([]); setSesion(null); setClasses([]);
    if (!moduleId) return;
    apiFetch(`/api/monitor/classes?module_id=${moduleId}`)
      .then((r: { items?: ClassItem[] }) => setClasses(r?.items || []))
      .catch(() => {});
  }, [moduleId]);

  // Materia → fechas con sesiones
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFecha(""); setFechas([]); setDetalle([]); setSesion(null);
    if (!classId) return;
    setLoadingFechas(true);
    apiFetch(`/api/monitor/attendance/fechas?module_id=${moduleId || "todos"}&class_id=${classId}`)
      .then((r: { items?: SesionFecha[] }) => setFechas(r?.items || []))
      .catch(() => {})
      .finally(() => setLoadingFechas(false));
  }, [moduleId, classId]);

  // Fecha → cargar sesión y detalle
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetalle([]); setSesion(null);
    if (!moduleId || !classId || !fecha) return;
    setLoadingDetalle(true);
    apiFetch(`/api/monitor/attendance/consulta?module_id=${moduleId}&class_id=${classId}&fecha=${fecha}`)
      .then((r: { sesion?: SesionInfo; detalle?: DetalleRow[] }) => {
        setSesion(r?.sesion ?? null);
        setDetalle(r?.detalle || []);
      })
      .catch(() => {})
      .finally(() => setLoadingDetalle(false));
  }, [moduleId, classId, fecha]);

  const selectedClass = classes.find((c) => String(c.id) === classId);

  function handleDescargar() {
    if (!detalle.length) return;
    const rows = detalle.map((d) => ({
      Cédula:      d.cedula ?? "—",
      Nombre:      d.name   ?? "—",
      Materia:     selectedClass?.name ?? "—",
      Fecha:       fmtFecha(fecha),
      Asistencia:  d.asistio ? "✓" : "✗",
      Motivo:      d.asistio ? "" : (d.motivo === "sin información" ? "" : d.motivo),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistencia");
    XLSX.writeFile(wb, `asistencia_${course?.name ?? "curso"}_${fecha}.xlsx`);
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0 }}>Consultar asistencia</h2>

      {/* Cabecera */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        <div>
          <div className="label">Curso</div>
          <div className="select" style={{ cursor: "default", userSelect: "none" }}>{course?.name ?? "—"}</div>
        </div>

        <div>
          <div className="label">Módulo</div>
          <select className="select" style={{ width: "100%" }} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">Selecciona...</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div>
          <div className="label">Materia</div>
          <select className="select" style={{ width: "100%" }} value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!moduleId}>
            <option value="">Selecciona...</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <div className="label">Fecha clase</div>
          <select className="select" style={{ width: "100%" }} value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={!classId || loadingFechas}>
            <option value="">
              {loadingFechas ? "Cargando…" : fechas.length === 0 && classId ? "Sin sesiones" : "Selecciona…"}
            </option>
            {fechas.map((f) => (
              <option key={f.id} value={f.fecha_clase}>{fmtFecha(f.fecha_clase)}</option>
            ))}
          </select>
        </div>

        {sesion && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="label">Profesor que dictó la clase</div>
            <div className="select" style={{ cursor: "default", userSelect: "none" }}>
              {sesion.profesor_asistio
                ? (sesion.teacher_name ?? "—")
                : `Reemplazo: ${sesion.profesor_reemplazo ?? "—"} (titular: ${sesion.teacher_name ?? "—"})`}
            </div>
          </div>
        )}
      </div>

      {/* Grilla */}
      {loadingDetalle ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>Cargando asistencia...</div>
      ) : detalle.length > 0 ? (
        <>
          <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--stroke)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(14,165,233,.08)" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left" }}>Cédula</th>
                  <th style={{ padding: "10px 12px", textAlign: "left" }}>Nombre</th>
                  <th style={{ padding: "10px 12px", textAlign: "left" }}>Materia</th>
                  <th style={{ padding: "10px 12px", textAlign: "center" }}>Asistencia</th>
                  <th style={{ padding: "10px 12px", textAlign: "left" }}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((d, idx) => (
                  <tr key={d.id_student} style={{ borderTop: "1px solid var(--stroke)", background: idx % 2 === 0 ? "transparent" : "rgba(14,165,233,.03)" }}>
                    <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{d.cedula ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{d.name ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{selectedClass?.name ?? "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: d.asistio ? "#15803d" : "#dc2626" }}>
                        {d.asistio ? "✓" : "✗"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 12 }}>
                      {d.asistio ? "—" : (d.motivo === "sin información" ? "—" : d.motivo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn actionBtn" onClick={handleDescargar}>Descargar</button>
          </div>
        </>
      ) : fecha ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>No hay datos para esta sesión.</div>
      ) : null}
    </div>
  );
}
