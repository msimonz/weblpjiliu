"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";

const MESES = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function fmtFecha(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${MESES[Number(m) - 1]}-${y}`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type ModuleItem  = { id: number; name: string };
type ClassItem   = { id: number; name: string };
type TeacherItem = { id: string; name: string };
type StudentItem = { id: string; name: string; cedula: string | null };
type DetalleRow  = { id_student: string; name: string; cedula: string | null; asistio: boolean; motivo: string };

function makeDefaultDetalle(students: StudentItem[]): DetalleRow[] {
  return students.map((s) => ({ id_student: s.id, name: s.name, cedula: s.cedula, asistio: false, motivo: "sin información" }));
}

type Props = { me: Record<string, unknown> };

export default function RegistrarAsistencia({ me }: Props) {
  const course = me?.course as { id: number; name: string; year: number } | null;

  const [modules,  setModules]  = useState<ModuleItem[]>([]);
  const [classes,  setClasses]  = useState<ClassItem[]>([]);
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);

  const [moduleId,            setModuleId]            = useState("");
  const [classId,             setClassId]             = useState("");
  const [fecha,               setFecha]               = useState(todayISO());
  const [assignedTeacherId,   setAssignedTeacherId]   = useState<string>("");
  const [assignedTeacherName, setAssignedTeacherName] = useState<string>("");
  const [suplentId,           setSuplentId]           = useState<string>("");
  const [profesorAsistio,     setProfAsistio]         = useState<boolean | null>(true);

  const [detalle,         setDetalle]         = useState<DetalleRow[]>([]);
  const [filterStudentId, setFilterStudentId] = useState("");
  const [bulkAsistio,     setBulkAsistio]     = useState<boolean | null>(false);
  const [sesionId,        setSesionId]        = useState<number | null>(null);
  const [loadingSession,  setLoadingSession]  = useState(false);
  const [saving,          setSaving]          = useState(false);
  const [msg,             setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const detalleVisible = filterStudentId ? detalle.filter((r) => r.id_student === filterStudentId) : detalle;
  const dateInputRef = useRef<HTMLInputElement>(null);

  // ── Carga inicial ────────────────────────────────────────────
  useEffect(() => {
    apiFetch("/api/monitor/modules")
      .then((r: { items?: ModuleItem[] }) => setModules(r?.items || []))
      .catch(() => {});
    apiFetch("/api/monitor/teachers")
      .then((r: { items?: TeacherItem[] }) => setTeachers(r?.items || []))
      .catch((e) => console.error("teachers fetch:", e));
    apiFetch("/api/monitor/students")
      .then((r: { items?: StudentItem[] }) => {
        const s = r?.items || [];
        setStudents(s);
        setDetalle(makeDefaultDetalle(s));
      })
      .catch(() => {});
  }, []);

  // ── Cambio de módulo → cargar materias ──────────────────────
  useEffect(() => {
    setClassId(""); setAssignedTeacherId(""); setAssignedTeacherName(""); setSuplentId(""); setClasses([]); setSesionId(null); setBulkAsistio(false);
    if (!moduleId) return;
    apiFetch(`/api/monitor/classes?module_id=${moduleId}`)
      .then((r: { items?: ClassItem[] }) => setClasses(r?.items || []))
      .catch((e) => console.error("classes fetch:", e));
  }, [moduleId]);

  // ── Cambio de materia → cargar profesor asignado ────────────
  useEffect(() => {
    setAssignedTeacherId(""); setAssignedTeacherName(""); setSuplentId(""); setSesionId(null); setBulkAsistio(false);
    if (!classId) return;
    apiFetch(`/api/monitor/teacher?class_id=${classId}`)
      .then((r: { teacher?: { id?: string; name?: string } }) => {
        const id   = r?.teacher?.id   ?? "";
        const name = r?.teacher?.name ?? "";
        setAssignedTeacherId(id);
        setAssignedTeacherName(name);
        if (id) {
          setTeachers((prev) =>
            prev.some((t) => t.id === id) ? prev : [{ id, name }, ...prev]
          );
        }
      })
      .catch((e) => console.error("teacher fetch:", e));
  }, [classId]);

  function handleProfAsistio(val: boolean) {
    setProfAsistio(val);
    if (val) setSuplentId("");
  }

  // ── Carga sesión existente cuando filtros están completos ────
  const loadSession = useCallback(async () => {
    if (!moduleId || !classId || !fecha) return;
    setLoadingSession(true);
    setSesionId(null);
    try {
      const r = await apiFetch(
        `/api/monitor/attendance/session?module_id=${moduleId}&class_id=${classId}&fecha=${fecha}`
      ) as { sesion?: { id: number; id_teacher: string; profesor_asistio: boolean }; detalle?: Array<{ id_student: string; asistio: boolean; motivo: string }> };
      if (r?.sesion) {
        setSesionId(r.sesion.id);
        setProfAsistio(r.sesion.profesor_asistio);
        if (r.sesion.profesor_asistio === false) {
          setSuplentId(r.sesion.id_teacher);
        } else {
          setSuplentId("");
        }
        const saved = new Map<string, { asistio: boolean; motivo: string }>(
          (r.detalle || []).map((d) => [d.id_student, { asistio: d.asistio, motivo: d.motivo }])
        );
        setDetalle((prev) =>
          prev.map((row) => {
            const s = saved.get(row.id_student);
            return s ? { ...row, asistio: s.asistio, motivo: s.motivo } : row;
          })
        );
        setBulkAsistio(false);
      } else {
        setDetalle(makeDefaultDetalle(students));
        setProfAsistio(true);
        setBulkAsistio(false);
      }
    } catch {
      // si falla, mantenemos defaults
    } finally {
      setLoadingSession(false);
    }
  }, [moduleId, classId, fecha, students]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // ── Helpers de edición ───────────────────────────────────────
  function setAsistio(id: string, val: boolean) {
    setBulkAsistio(null);
    setDetalle((prev) =>
      prev.map((r) => r.id_student === id ? { ...r, asistio: val, motivo: val ? "sin información" : r.motivo } : r)
    );
  }
  function setMotivo(id: string, val: string) {
    setDetalle((prev) => prev.map((r) => r.id_student === id ? { ...r, motivo: val } : r));
  }
  function setBulkAll(val: boolean) {
    setBulkAsistio(val);
    setDetalle((prev) =>
      prev.map((r) => ({ ...r, asistio: val, motivo: val ? "sin información" : r.motivo }))
    );
  }

  // ── Guardar ──────────────────────────────────────────────────
  async function handleGuardar() {
    if (!moduleId || !classId || !fecha) return setMsg({ type: "err", text: "Completa módulo, materia y fecha." });
    if (profesorAsistio === true && !assignedTeacherId) return setMsg({ type: "err", text: "No hay profesor asignado a esta materia." });
    if (profesorAsistio === false && !suplentId) return setMsg({ type: "err", text: "Seleccione un profesor suplente." });
    setSaving(true);
    setMsg(null);
    try {
      await apiFetch("/api/monitor/attendance", {
        method: "POST",
        body: JSON.stringify({
          id_course:        course?.id,
          id_module:        Number(moduleId),
          id_class:         Number(classId),
          fecha_clase:      fecha,
          id_teacher:       profesorAsistio === true ? assignedTeacherId : suplentId,
          profesor_asistio: profesorAsistio,
          profesor_reemplazo: null,
          detalle:          detalle.map(({ id_student, asistio, motivo }) => ({ id_student, asistio, motivo })),
        }),
      });
      setMsg({ type: "ok", text: "✅ Asistencia guardada correctamente." });
      setTimeout(() => setMsg(null), 1000);
      loadSession();
    } catch (e) {
      setMsg({ type: "err", text: (e as { message?: string })?.message || "Error guardando asistencia" });
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!classId && profesorAsistio !== null &&
    (profesorAsistio === true ? !!assignedTeacherId : !!suplentId) && !saving;

  function handleCancelar() {
    setModuleId("");
    setClassId("");
    setFecha(todayISO());
    setAssignedTeacherId("");
    setAssignedTeacherName("");
    setSuplentId("");
    setProfAsistio(true);
    setClasses([]);
    setSesionId(null);
    setDetalle(makeDefaultDetalle(students));
    setFilterStudentId("");
    setBulkAsistio(false);
    setMsg(null);
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 0 }}>
        <h2 style={{ margin: 0 }}>Registrar asistencia</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn"
            onClick={handleCancelar}
            style={{ width: 120, minHeight: 36, background: "rgba(100,116,139,.18)", color: "var(--text)", border: "1px solid rgba(100,116,139,.3)" }}
          >
            Cancelar
          </button>
          <button
            className="btn actionBtn"
            onClick={handleGuardar}
            disabled={!canSave}
            style={{ width: 120, minHeight: 36, opacity: canSave ? 1 : 0.45 }}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* ── Fila 1: Curso | Fecha | Módulo | Materia | Profesor ── */}
      <div style={{ display: "grid", gridTemplateColumns: "0.5fr 0.7fr 1.5fr 1.5fr 1.8fr", gap: 14, marginBottom: 14, alignItems: "start", fontSize: 13 }}>
        <div>
          <div className="label">Curso</div>
          <div className="select" style={{ cursor: "default", userSelect: "none", fontSize: 13 }}>{course?.name ?? "—"}</div>
        </div>

        <div>
          <div className="label">Fecha clase</div>
          <div style={{ position: "relative" }}>
            <div
              className="select"
              style={{ cursor: "pointer", fontSize: 13, userSelect: "none" }}
              onClick={() => dateInputRef.current?.showPicker?.()}
            >
              {fecha ? fmtFecha(fecha) : "Selecciona..."}
            </div>
            <input
              ref={dateInputRef}
              type="date"
              style={{ position: "absolute", opacity: 0, width: 0, height: 0, top: 0, left: 0, pointerEvents: "none" }}
              max={todayISO()}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="label">Módulo</div>
          <select className="select" style={{ width: "100%", fontSize: 13 }} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">Selecciona...</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div>
          <div className="label">Materia</div>
          <select className="select" style={{ width: "100%", fontSize: 13 }} value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!moduleId}>
            <option value="">Selecciona...</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <div className="label" style={{ opacity: profesorAsistio === false ? 0.45 : 1 }}>Profesor</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                readOnly
                className="select"
                value={assignedTeacherName || "—"}
                style={{
                  width: "100%", fontSize: 13, cursor: "default",
                  color: "inherit",
                  opacity: profesorAsistio === false ? 0.3 : (assignedTeacherName ? 1 : 0.5),
                }}
              />
              {profesorAsistio === false && (
                <div style={{ marginTop: 8 }}>
                  <div className="label">Profesor suplente</div>
                  <select
                    className="select"
                    value={suplentId}
                    onChange={(e) => setSuplentId(e.target.value)}
                    style={{ width: "100%", fontSize: 13 }}
                  >
                    <option value="" style={{ color: "#6b7280" }}>Seleccione profesor suplente...</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id} style={{ color: "#000" }}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 500, fontSize: 12, flexShrink: 0, whiteSpace: "nowrap", paddingTop: 8 }}>
              <input
                type="checkbox"
                className="check-asistencia"
                checked={profesorAsistio === true}
                onChange={(e) => handleProfAsistio(e.target.checked)}
              />
              Asistió
            </label>
          </div>
        </div>
      </div>

      {/* ── Mensaje ── */}
      {msg && (
        <div className={msg.type === "ok" ? "msgOk" : "msgError"} style={{ marginBottom: 12 }}>{msg.text}</div>
      )}

      {/* ── Grilla de estudiantes ── */}
      {loadingSession ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>Cargando sesión...</div>
      ) : (
        <div style={{ maxWidth: 920, margin: "0 auto", overflowX: "auto", borderRadius: 14, border: "1px solid var(--stroke)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(14,165,233,.08)" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", whiteSpace: "nowrap" }}>
                  <select
                    className="select"
                    value={filterStudentId}
                    onChange={(e) => setFilterStudentId(e.target.value)}
                    style={{ fontSize: 13, padding: "4px 6px", fontWeight: 700 }}
                  >
                    <option value="" style={{ fontWeight: 900, color: "#000" }}>Cédula</option>
                    {detalle.map((r) => (
                      <option key={r.id_student} value={r.id_student} style={{ color: "#000" }}>{r.cedula ?? "—"}</option>
                    ))}
                  </select>
                </th>
                <th style={{ textAlign: "left", padding: "8px 12px" }}>
                  <select
                    className="select"
                    value={filterStudentId}
                    onChange={(e) => setFilterStudentId(e.target.value)}
                    style={{ fontSize: 13, padding: "4px 6px", fontWeight: 700 }}
                  >
                    <option value="" style={{ fontWeight: 900, color: "#000" }}>Estudiante</option>
                    {detalle.map((r) => (
                      <option key={r.id_student} value={r.id_student} style={{ color: "#000" }}>{r.name}</option>
                    ))}
                  </select>
                </th>
                <th style={{ padding: "8px 12px", textAlign: "center", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "inherit" }}>
                    Asistió
                  </div>
                  <input
                    type="checkbox"
                    className="check-asistencia"
                    checked={bulkAsistio === true}
                    onChange={(e) => setBulkAll(e.target.checked)}
                  />
                </th>
                <th style={{ padding: "10px 12px", textAlign: "left" }}>Motivo inasistencia</th>
              </tr>
            </thead>
            <tbody>
              {detalle.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 16, color: "var(--muted)", textAlign: "center" }}>
                    No hay estudiantes en este curso
                  </td>
                </tr>
              ) : detalleVisible.map((row, idx) => (
                <tr key={row.id_student} style={{ borderTop: "1px solid var(--stroke)", background: idx % 2 === 0 ? "transparent" : "rgba(14,165,233,.03)" }}>
                  <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{row.cedula ?? "—"}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 500 }}>{row.name}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      className="check-asistencia"
                      checked={row.asistio === true}
                      onChange={(e) => setAsistio(row.id_student, e.target.checked)}
                    />
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {!row.asistio ? (
                      <input
                        type="text"
                        className="select"
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "4px 8px",
                          color: row.motivo === "sin información" ? "rgba(148,163,184,0.25)" : "white",
                        }}
                        value={row.motivo}
                        onChange={(e) => setMotivo(row.id_student, e.target.value)}
                        onFocus={(e) => {
                          if (e.target.value === "sin información") {
                            setMotivo(row.id_student, "");
                            setTimeout(() => e.target.setSelectionRange(0, 0), 0);
                          }
                        }}
                        onBlur={(e) => {
                          if (e.target.value.trim() === "") {
                            setMotivo(row.id_student, "sin información");
                          }
                        }}
                        placeholder="sin información"
                      />
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
