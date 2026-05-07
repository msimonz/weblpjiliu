"use client";

import { useEffect, useState, useRef } from "react";
import { apiFetch } from "@/lib/api";
import * as XLSX from "xlsx";

const MESES = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function fmtFecha(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${MESES[Number(m) - 1]}-${y}`;
}

type LevelItem     = { id: number; name: string };
type CourseItem    = { id: number; name: string; year: number; level: number };
type ModuleItem    = { id: number; name: string };
type ClassItem     = { id: number; name: string };
type SesionFecha   = { id: number; fecha_clase: string };
type DetalleRow    = { id_student: string; name: string | null; cedula: string | null; asistio: boolean; motivo: string };
type SesionInfo    = { id: number; id_teacher: string; profesor_asistio: boolean; profesor_reemplazo: string | null; teacher_name: string | null };

type AsistenciaEntry   = { fecha: string; class_id?: number | null; asistio: boolean; motivo: string };
type DetalleTodasRow   = { id_student: string; name: string | null; cedula: string | null; asistencia: AsistenciaEntry[] };
type FechaInfo         = { fecha: string; class_id?: number | null; class_name?: string | null; teacher_name: string | null; profesor_asistio: boolean; profesor_reemplazo: string | null };
type ConsultaTodasResp = { fechas: FechaInfo[]; detalle: DetalleTodasRow[] };

export default function ConsultarAsistencia() {
  const [levels,    setLevels]    = useState<LevelItem[]>([]);
  const [courses,   setCourses]   = useState<CourseItem[]>([]);
  const [modules,   setModules]   = useState<ModuleItem[]>([]);
  const [classes,   setClasses]   = useState<ClassItem[]>([]);
  const [fechas,    setFechas]    = useState<SesionFecha[]>([]);
  const [detalle,   setDetalle]   = useState<DetalleRow[]>([]);
  const [sesion,    setSesion]    = useState<SesionInfo | null>(null);
  const [todasData, setTodasData] = useState<ConsultaTodasResp | null>(null);

  const [levelId,  setLevelId]  = useState("");
  const [courseId, setCourseId] = useState("");
  const [moduleId, setModuleId] = useState("todos");
  const [classId,  setClassId]  = useState("");
  const [fecha,    setFecha]    = useState("");

  const [loadingFechas,    setLoadingFechas]    = useState(false);
  const [loadingDetalle,   setLoadingDetalle]   = useState(false);
  const [filtroAsistencia, setFiltroAsistencia] = useState<"todas" | "asistio" | "no_asistio">("todas");

  const allClassesRef = useRef<ClassItem[]>([]);

  // Cargar niveles y cursos al montar
  useEffect(() => {
    apiFetch("/api/admin/levels")
      .then((r: { items?: LevelItem[] }) => setLevels(r?.items || []))
      .catch(() => {});
    apiFetch("/api/secretaria/attendance/courses")
      .then((r: { items?: CourseItem[] }) => setCourses(r?.items || []))
      .catch(() => {});
  }, []);

  // Curso → módulos + todas las clases del curso
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModuleId(""); setClassId(""); setFecha(""); setFechas([]); setDetalle([]); setSesion(null); setModules([]); setClasses([]); allClassesRef.current = []; setTodasData(null);
    if (!courseId) return;
    apiFetch(`/api/secretaria/attendance/modules?course_id=${courseId}`)
      .then((r: { items?: ModuleItem[] }) => setModules(r?.items || []))
      .catch(() => {});
    apiFetch(`/api/secretaria/attendance/classes?course_id=${courseId}&module_id=todos`)
      .then((r: { items?: ClassItem[] }) => {
        const all = r?.items || [];
        allClassesRef.current = all;
        setClasses(all);
      })
      .catch(() => {});
  }, [courseId]);

  // Módulo → clases
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClassId(""); setFecha(""); setFechas([]); setDetalle([]); setSesion(null); setTodasData(null);
    if (!courseId) return;
    if (!moduleId || moduleId === "todos") {
      setClasses(allClassesRef.current);
      return;
    }
    apiFetch(`/api/secretaria/attendance/classes?course_id=${courseId}&module_id=${moduleId}`)
      .then((r: { items?: ClassItem[] }) => setClasses(r?.items || []))
      .catch(() => {});
  }, [courseId, moduleId]);

  // Módulo / Materia → fechas (ambos opcionales, curso requerido)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFecha(""); setFechas([]); setDetalle([]); setSesion(null); setTodasData(null);
    if (!courseId) return;
    setLoadingFechas(true);
    const params = new URLSearchParams({ course_id: courseId, module_id: moduleId || "todos", class_id: classId || "todas" });
    apiFetch(`/api/secretaria/attendance/fechas?${params.toString()}`)
      .then((r: { items?: SesionFecha[] }) => setFechas(r?.items || []))
      .catch(() => {})
      .finally(() => setLoadingFechas(false));
  }, [courseId, moduleId, classId]);

  // Fecha → detalle
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetalle([]); setSesion(null); setTodasData(null);
    if (!courseId || (!classId && (!fecha || fecha === "todas"))) return;
    setLoadingDetalle(true);
    const effectiveModule = moduleId || "todos";
    const effectiveClass  = classId || "todas";
    const isTodasMode = !fecha || fecha === "todas" || !moduleId || moduleId === "todos" || classId === "todas";
    if (isTodasMode) {
      const params = new URLSearchParams({ course_id: courseId, module_id: effectiveModule, class_id: effectiveClass });
      if (fecha && fecha !== "todas") params.set("fecha", fecha);
      apiFetch(`/api/secretaria/attendance/consulta-todas?${params.toString()}`)
        .then((r: ConsultaTodasResp) => setTodasData(r))
        .catch(() => {})
        .finally(() => setLoadingDetalle(false));
    } else {
      apiFetch(`/api/secretaria/attendance/consulta?course_id=${courseId}&module_id=${moduleId}&class_id=${classId}&fecha=${fecha}`)
        .then((r: { sesion?: SesionInfo; detalle?: DetalleRow[] }) => {
          setSesion(r?.sesion ?? null);
          setDetalle(r?.detalle || []);
        })
        .catch(() => {})
        .finally(() => setLoadingDetalle(false));
    }
  }, [courseId, moduleId, classId, fecha]);

  function handleCancelar() {
    setLevelId(""); setCourseId(""); setModuleId("todos"); setClassId(""); setFecha("");
    setModules([]); setClasses([]); setFechas([]);
    setDetalle([]); setSesion(null); setTodasData(null);
    setFiltroAsistencia("todas");
  }

  // Niveles que tienen al menos un curso
  const availableLevelIds = new Set(courses.map((c) => c.level));
  const displayedLevels   = levels.filter((l) => availableLevelIds.has(l.id));

  // Cursos filtrados por nivel seleccionado
  const filteredCourses = levelId
    ? courses.filter((c) => String(c.level) === levelId)
    : courses;

  const selectedCourse = courses.find((c) => String(c.id) === courseId);
  const selectedClass  = classes.find((c) => String(c.id) === classId);
  const isTodasMode    = !fecha || fecha === "todas" || !moduleId || moduleId === "todos" || classId === "todas";
  const hasData        = isTodasMode
    ? (todasData?.detalle?.length ?? 0) > 0
    : detalle.length > 0;

  const detalleFiltered = filtroAsistencia === "todas"
    ? detalle
    : detalle.filter((d) => filtroAsistencia === "asistio" ? d.asistio : !d.asistio);

  const todasDetalleFiltered = !todasData ? [] : filtroAsistencia === "todas"
    ? todasData.detalle
    : todasData.detalle.filter((d) => {
        const inasistencias = d.asistencia.filter((a) => !a.asistio).length;
        return filtroAsistencia === "asistio" ? inasistencias === 0 : inasistencias > 0;
      });

  function handleDescargar() {
    if (isTodasMode) {
      if (!todasData?.detalle?.length) return;
      const { fechas: fechasList, detalle: rows } = todasData;
      const multiClass = fechasList.some((fi) => fi.class_name);
      const xlsRows = rows.map((d) => {
        const row: Record<string, string> = { Cédula: d.cedula ?? "—", Nombre: d.name ?? "—" };
        for (const fi of fechasList) {
          const entry = d.asistencia.find((a) => a.fecha === fi.fecha && (!fi.class_id || a.class_id === fi.class_id));
          const colKey = multiClass && fi.class_name ? `${fmtFecha(fi.fecha)} / ${fi.class_name}` : fmtFecha(fi.fecha);
          row[colKey] = entry
            ? entry.asistio ? "✓" : `✗${(entry.motivo && entry.motivo !== "sin información") ? ` — ${entry.motivo}` : ""}`
            : "—";
        }
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(xlsRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Asistencia");
      XLSX.writeFile(wb, `asistencia_${selectedCourse?.name ?? "curso"}_todas.xlsx`);
    } else {
      if (!detalle.length) return;
      const rows = detalle.map((d) => ({
        Cédula:   d.cedula ?? "—",
        Nombre:   d.name   ?? "—",
        Materia:  selectedClass?.name ?? "—",
        [fmtFecha(fecha)]: d.asistio ? "✓" : `✗${(d.motivo && d.motivo !== "sin información") ? ` — ${d.motivo}` : ""}`,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Asistencia");
      XLSX.writeFile(wb, `asistencia_${selectedCourse?.name ?? "curso"}_${fecha}.xlsx`);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0 }}>Reporte de asistencia</h2>

      {/* Filtros + botón Descargar */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>

        {/* Nivel */}
        <div style={{ flex: "0 0 auto", width: "clamp(100px, 12%, 160px)" }}>
          <div className="label">Nivel</div>
          <select
            className="select"
            style={{ width: "100%" }}
            value={levelId}
            onChange={(e) => {
              setLevelId(e.target.value);
              setCourseId("");
            }}
          >
            <option value="">Todos...</option>
            {displayedLevels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        {/* Curso */}
        <div style={{ flex: "0 0 auto", width: "clamp(100px, 12%, 160px)" }}>
          <div className="label">Curso</div>
          <select
            className="select"
            style={{ width: "100%" }}
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">Selecciona...</option>
            {filteredCourses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Módulo */}
        <div style={{ flex: "1 1 140px" }}>
          <div className="label">Módulo</div>
          <select className="select" style={{ width: "100%" }} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="todos">— Todos —</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        {/* Materia */}
        <div style={{ flex: "1 1 140px" }}>
          <div className="label">Materia</div>
          <select className="select" style={{ width: "100%" }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Selecciona...</option>
            {classes.length > 0 && <option value="todas">— Todas —</option>}
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Fecha clase */}
        <div style={{ flex: "1 1 140px" }}>
          <div className="label">Fecha clase</div>
          <select className="select" style={{ width: "100%" }} value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={!courseId || loadingFechas}>
            <option value="">
              {loadingFechas ? "Cargando…" : fechas.length === 0 ? "Sin asistencia registrada" : "Selecciona…"}
            </option>
            {fechas.length > 0 && <option value="todas">— Todas —</option>}
            {fechas.map((f) => (
              <option key={f.id} value={f.fecha_clase}>{fmtFecha(f.fecha_clase)}</option>
            ))}
          </select>
        </div>

        {/* Botones Cancelar + Descargar */}
        <button
          type="button"
          className="btn"
          onClick={handleCancelar}
          style={{
            alignSelf: "flex-end",
            whiteSpace: "nowrap",
            background: "linear-gradient(180deg, #374151 0%, #1f2937 100%)",
            border: "1px solid #374151",
            color: "#fff",
          }}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btnLight"
          onClick={handleDescargar}
          disabled={!hasData}
          style={{
            alignSelf: "flex-end",
            background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
            border: "1px solid rgba(34,197,94,.8)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(34,197,94,.35)",
            opacity: hasData ? 1 : 0.4,
            cursor: hasData ? "pointer" : "default",
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
      </div>

      {/* Radio filtro */}
      {classId && (
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16, fontSize: 15 }}>
          {(["todas", "asistio", "no_asistio"] as const).map((val) => (
            <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
              <input
                type="radio"
                name="filtroAsistencia"
                value={val}
                checked={filtroAsistencia === val}
                onChange={() => setFiltroAsistencia(val)}
                style={{ width: 17, height: 17, cursor: "pointer" }}
              />
              {val === "todas" ? "Todas" : val === "asistio" ? "Asistió" : "No Asistió"}
            </label>
          ))}
        </div>
      )}


      {/* Grilla */}
      {loadingDetalle ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>Cargando asistencia...</div>
      ) : isTodasMode && todasData && todasData.detalle.length > 0 ? (
        // ── Modo TODAS las fechas ──
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "60vh", borderRadius: 14, border: "1px solid var(--stroke)" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(14,165,233,.08)" }}>
                <th style={{ position: "sticky", top: 0, left: 0, zIndex: 4, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "left", minWidth: 90, borderBottom: "1px solid var(--stroke)" }}>Cédula</th>
                <th style={{ position: "sticky", top: 0, left: 90, zIndex: 4, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "left", minWidth: 150, borderBottom: "1px solid var(--stroke)" }}>Nombre</th>
                <th style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "center", borderBottom: "1px solid var(--stroke)" }}>Inasistencias</th>
                {todasData.fechas.map((fi, i) => (
                  <th key={i} style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "center", whiteSpace: "nowrap", borderBottom: "1px solid var(--stroke)" }}>
                    {fmtFecha(fi.fecha)}
                    {fi.class_name && <div style={{ fontSize: 10, fontWeight: 400, color: "var(--muted)", marginTop: 2 }}>{fi.class_name}</div>}
                    <div style={{ fontSize: 10, fontWeight: 400, color: "var(--muted)", marginTop: 2 }}>
                      {fi.profesor_asistio ? `Prof: ${fi.teacher_name ?? "—"}` : `Prof-remp: ${fi.profesor_reemplazo ?? fi.teacher_name ?? "—"}`}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {todasDetalleFiltered.map((d, idx) => {
                const inasistencias = d.asistencia.filter((a) => !a.asistio).length;
                const rowBg    = idx % 2 === 0 ? "transparent" : "rgba(14,165,233,.03)";
                const stickyBg = idx % 2 === 0
                  ? "var(--bg0)"
                  : "color-mix(in srgb, rgb(14,165,233) 3%, var(--bg0))";
                return (
                  <tr key={d.id_student} style={{ background: rowBg }}>
                    <td style={{ position: "sticky", left: 0, zIndex: 1, background: stickyBg, padding: "8px 12px", color: "var(--muted)", borderTop: "1px solid var(--stroke)" }}>{d.cedula ?? "—"}</td>
                    <td style={{ position: "sticky", left: 90, zIndex: 1, background: stickyBg, padding: "8px 12px", fontWeight: 500, borderTop: "1px solid var(--stroke)" }}>{d.name ?? "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: inasistencias > 0 ? "#dc2626" : "#15803d", borderTop: "1px solid var(--stroke)" }}>
                      {inasistencias}
                    </td>
                    {todasData.fechas.map((fi, i) => {
                      const entry = d.asistencia.find((a) => a.fecha === fi.fecha && (!fi.class_id || a.class_id === fi.class_id));
                      if (!entry) return (
                        <td key={i} style={{ padding: "8px 12px", textAlign: "center", color: "var(--muted)", borderTop: "1px solid var(--stroke)" }}>—</td>
                      );
                      return (
                        <td key={i} style={{ padding: "8px 12px", textAlign: "center", borderTop: "1px solid var(--stroke)" }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: entry.asistio ? "#15803d" : "#dc2626" }}>
                            {entry.asistio ? "✓" : "✗"}
                          </span>
                          {!entry.asistio && entry.motivo && entry.motivo !== "sin información" && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{entry.motivo}</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : detalleFiltered.length > 0 ? (
        // ── Modo una fecha ──
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "60vh", borderRadius: 14, border: "1px solid var(--stroke)" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(14,165,233,.08)" }}>
                <th style={{ position: "sticky", top: 0, left: 0, zIndex: 4, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "left", minWidth: 90, borderBottom: "1px solid var(--stroke)" }}>Cédula</th>
                <th style={{ position: "sticky", top: 0, left: 90, zIndex: 4, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "left", minWidth: 150, borderBottom: "1px solid var(--stroke)" }}>Nombre</th>
                <th style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "center", borderBottom: "1px solid var(--stroke)" }}>Inasistencias</th>
                <th style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--stroke)" }}>Materia</th>
                <th style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", padding: "10px 12px", textAlign: "center", whiteSpace: "nowrap", borderBottom: "1px solid var(--stroke)" }}>
                  {fmtFecha(fecha)}
                  {sesion && (
                    <div style={{ fontSize: 10, fontWeight: 400, color: "var(--muted)", marginTop: 2 }}>
                      {sesion.profesor_asistio ? `Prof: ${sesion.teacher_name ?? "—"}` : `Prof-remp: ${sesion.profesor_reemplazo ?? sesion.teacher_name ?? "—"}`}
                    </div>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {detalleFiltered.map((d, idx) => {
                const stickyBg = idx % 2 === 0 ? "var(--bg0)" : "color-mix(in srgb, rgb(14,165,233) 3%, var(--bg0))";
                return (
                <tr key={d.id_student} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(14,165,233,.03)" }}>
                  <td style={{ position: "sticky", left: 0, zIndex: 1, background: stickyBg, padding: "8px 12px", color: "var(--muted)", borderTop: "1px solid var(--stroke)" }}>{d.cedula ?? "—"}</td>
                  <td style={{ position: "sticky", left: 90, zIndex: 1, background: stickyBg, padding: "8px 12px", fontWeight: 500, borderTop: "1px solid var(--stroke)" }}>{d.name ?? "—"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: d.asistio ? "#15803d" : "#dc2626", borderTop: "1px solid var(--stroke)" }}>
                    {d.asistio ? 0 : 1}
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--muted)", borderTop: "1px solid var(--stroke)" }}>{selectedClass?.name ?? "—"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center", borderTop: "1px solid var(--stroke)" }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: d.asistio ? "#15803d" : "#dc2626" }}>
                      {d.asistio ? "✓" : "✗"}
                    </span>
                    {!d.asistio && d.motivo && d.motivo !== "sin información" && (
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{d.motivo}</div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (courseId && classId) ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>No hay datos para esta sesión.</div>
      ) : null}
    </div>
  );
}
