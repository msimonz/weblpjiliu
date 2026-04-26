"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Course   = { id: number; name: string; level: number; year: string | null };
type LevelMini = { id: number; name: string };

type ExamMini = {
  id: number;
  title: string;
  module_id:   number | null;
  module_name: string | null;
  group_id:    number | null;
  group_name:  string | null;
  class_id:    number | null;
  class_name:  string | null;
  class_level: number | null;
};

type ScheduleItem = {
  id: number;
  year: number;
  fecha_ini: string | null;
  fecha_fin: string | null;
  fecha_limite_ver: string | null;
  habilitado: boolean;
  id_evaluation: number;
  id_course: number;
  evaluation: {
    id: number;
    title: string;
    tiempo_minutos: number | null;
    module: { id: number; name: string } | null;
    group:  { id: number; name: string } | null;
    class:  { id: number; name: string } | null;
  };
  course: { id: number; name: string; year: string; level: number };
};

type GridRow = {
  rowKey:       string;
  examId:       number;
  examTitle:    string;
  moduleId:     number | null;
  moduleName:   string | null;
  groupId:      number | null;
  groupName:    string | null;
  classId:      number | null;
  className:    string | null;
  classLevel:   number | null;
  scheduleId:   number | null;
  courseId:     number | null;
  courseName:   string | null;
  courseYear:   string | null;
  fechaIni:     string | null;
  fechaFin:     string | null;
  fechaLimiteVer: string | null;
  habilitado:   boolean;
};

type EditState = {
  fecha_ini:        string;
  fecha_fin:        string;
  fecha_limite_ver: string;
  courseId:         string;
};

type AttemptItem = {
  id_student: string;
  name: string;
  cedula: string;
  calificacion: number | null;
  finalizado_at: string | null;
};

type AttemptsCtx = {
  id_evaluation: number;
  id_course:     number;
  title:         string;
  courseName:    string;
};

interface Props { courses: Course[] }

// ─── Helpers (hora Colombia UTC-5) ────────────────────────────────────────────

const COL_OFFSET_MS = -5 * 60 * 60 * 1000;

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const colMs = new Date(iso).getTime() + COL_OFFSET_MS;
  return new Date(colMs).toISOString().slice(0, 16);
}

function fromDatetimeLocal(val: string): string | null {
  if (!val) return null;
  const [datePart, timePart] = val.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min]  = timePart.split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h, min) - COL_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

function addDaysToLocal(val: string, days: number): string {
  if (!val) return "";
  const utcIso = fromDatetimeLocal(val);
  if (!utcIso) return "";
  return toDatetimeLocal(new Date(new Date(utcIso).getTime() + days * 86400000).toISOString());
}

function defaultColombiaDates(): { fechaIni: string; fechaFin: string; fechaLimiteVer: string } {
  const colMs  = Date.now() + COL_OFFSET_MS;
  const colNow = new Date(colMs);
  const pad    = (n: number) => String(n).padStart(2, "0");
  const fmt    = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

  const fechaIni       = fmt(colNow);
  const daysUntilSun   = colNow.getUTCDay() === 0 ? 7 : 7 - colNow.getUTCDay();
  const sundayCol      = new Date(colMs + daysUntilSun * 86400000);
  sundayCol.setUTCHours(23, 59, 0, 0);
  const fechaFin       = fmt(sundayCol);
  const fechaLimiteVer = fmt(new Date(sundayCol.getTime() + 15 * 86400000));
  return { fechaIni, fechaFin, fechaLimiteVer };
}

const MESES = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function fmtColombiaParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const d   = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/Bogota" }));
  const day  = String(d.getDate()).padStart(2, "0");
  const mon  = MESES[d.getMonth()];
  const year = d.getFullYear();
  const hh   = d.getHours();
  const mm   = String(d.getMinutes()).padStart(2, "0");
  const h12  = String(hh % 12 || 12).padStart(2, "0");
  const ampm = hh < 12 ? "am" : "pm";
  return { date: `${day}-${mon}-${year}`, time: `${h12}:${mm} ${ampm}` };
}
function FmtDate({ iso }: { iso: string | null }) {
  const { date, time } = fmtColombiaParts(iso);
  if (!time) return <span>—</span>;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {date}
      <span style={{ fontSize: 11, opacity: 0.85 }}>&nbsp;&nbsp;&nbsp;{time}</span>
    </span>
  );
}

function DateField({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const inputRef = useRef<HTMLInputElement>(null);
  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.click(); }
  }
  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div onClick={openPicker} style={{
        fontSize: 12, fontWeight: 400, padding: "3px 28px 3px 6px", border: "1px solid var(--stroke)",
        borderRadius: 6, background: "var(--input-bg, var(--card))", color: "var(--text)",
        whiteSpace: "nowrap", cursor: "pointer", minWidth: 160,
      }}>
        <span style={{ flex: 1 }}>{value ? <FmtDate iso={fromDatetimeLocal(value)} /> : "—"}</span>
        <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 13, pointerEvents: "none", opacity: 0.55 }}>📅</span>
      </div>
      <input ref={inputRef} type="datetime-local" value={value} onChange={e => onChange(e.target.value)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0, top: 0, left: 0 }} />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HabilitarExamenes({ courses }: Props) {
  const [schedules,  setSchedules]  = useState<ScheduleItem[]>([]);
  const [allExams,   setAllExams]   = useState<ExamMini[]>([]);
  const [levels,     setLevels]     = useState<LevelMini[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [errMsg,     setErrMsg]     = useState<string | null>(null);
  const [okMsg,      setOkMsg]      = useState<string | null>(null);

  // Filtros de grilla
  const [filterLevel,    setFilterLevel]    = useState<string>("");
  const [filterModuleId, setFilterModuleId] = useState<string>("");
  const [filterGroupId,  setFilterGroupId]  = useState<string>("");
  const [filterClassId,  setFilterClassId]  = useState<string>("");
  const [filterCourseId, setFilterCourseId] = useState<string>("");

  // Edición inline
  const [editing,  setEditing]  = useState<Record<string, EditState>>({});
  const [saving,   setSaving]   = useState<Record<string, boolean>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  // Modal intentos
  const [attemptsCtx,     setAttemptsCtx]     = useState<AttemptsCtx | null>(null);
  const [attempts,        setAttempts]        = useState<AttemptItem[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [resetting,       setResetting]       = useState<Record<string, boolean>>({});

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadSchedules() {
    setLoading(true);
    setErrMsg(null);
    try {
      const r = await apiFetch<{ items?: ScheduleItem[] }>("/api/admin/exam-schedules");
      setSchedules(r?.items || []);
    } catch (e) {
      setErrMsg((e as { message?: string })?.message || "Error cargando programaciones");
    } finally {
      setLoading(false);
    }
  }

  async function loadExams() {
    try {
      type ExamApiItem = { id: number; title: string; module?: { id: number; name: string }; group?: { id: number; name: string }; class?: { id: number; name: string; level: number } };
      const r = await apiFetch<{ items?: ExamApiItem[] }>("/api/admin/exams");
      setAllExams((r?.items || []).map(ev => ({
        id:          ev.id,
        title:       ev.title,
        module_id:   ev.module?.id   ?? null,
        module_name: ev.module?.name ?? null,
        group_id:    ev.group?.id    ?? null,
        group_name:  ev.group?.name  ?? null,
        class_id:    ev.class?.id    ?? null,
        class_name:  ev.class?.name  ?? null,
        class_level: ev.class?.level ?? null,
      })));
    } catch { /* silencioso */ }
  }

  async function loadLevels() {
    try {
      const r = await apiFetch<{ items?: LevelMini[] }>("/api/admin/levels");
      setLevels(r?.items || []);
    } catch { /* silencioso */ }
  }

  useEffect(() => {
    loadSchedules();
    loadExams();
    loadLevels();
  }, []);

  function flash(msg: string) {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 3500);
  }

  // ── Grid rows: merge allExams + schedules ────────────────────────────────

  const gridRows = useMemo<GridRow[]>(() => {
    const rows: GridRow[] = [];

    // Filas con programación
    for (const s of schedules) {
      rows.push({
        rowKey:        `sched_${s.id}`,
        examId:        s.evaluation.id,
        examTitle:     s.evaluation.title,
        moduleId:      s.evaluation.module?.id   ?? null,
        moduleName:    s.evaluation.module?.name ?? null,
        groupId:       s.evaluation.group?.id    ?? null,
        groupName:     s.evaluation.group?.name  ?? null,
        classId:       s.evaluation.class?.id    ?? null,
        className:     s.evaluation.class?.name  ?? null,
        classLevel:    s.course.level ?? null,
        scheduleId:    s.id,
        courseId:      s.id_course,
        courseName:    s.course.name,
        courseYear:    s.course.year,
        fechaIni:      s.fecha_ini,
        fechaFin:      s.fecha_fin,
        fechaLimiteVer: s.fecha_limite_ver,
        habilitado:    s.habilitado,
      });
    }

    // Exámenes sin ninguna programación
    const scheduledExamIds = new Set(schedules.map(s => s.id_evaluation));
    for (const ex of allExams) {
      if (!scheduledExamIds.has(ex.id)) {
        rows.push({
          rowKey:        `exam_${ex.id}`,
          examId:        ex.id,
          examTitle:     ex.title,
          moduleId:      ex.module_id,
          moduleName:    ex.module_name,
          groupId:       ex.group_id,
          groupName:     ex.group_name,
          classId:       ex.class_id,
          className:     ex.class_name,
          classLevel:    ex.class_level,
          scheduleId:    null,
          courseId:      null,
          courseName:    null,
          courseYear:    null,
          fechaIni:      null,
          fechaFin:      null,
          fechaLimiteVer: null,
          habilitado:    false,
        });
      }
    }

    return rows;
  }, [schedules, allExams]);

  // ── Opciones en cascada para los filtros ─────────────────────────────────

  const baseByLevel = useMemo(() =>
    filterLevel ? allExams.filter(e => String(e.class_level) === filterLevel) : allExams,
    [allExams, filterLevel]);

  const filterAvailableModules = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of baseByLevel) if (e.module_id) seen.set(e.module_id, e.module_name ?? "");
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [baseByLevel]);

  const baseByModule = useMemo(() =>
    filterModuleId ? baseByLevel.filter(e => String(e.module_id) === filterModuleId) : baseByLevel,
    [baseByLevel, filterModuleId]);

  const filterAvailableGroups = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of baseByModule) if (e.group_id) seen.set(e.group_id, e.group_name ?? "");
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [baseByModule]);

  const baseByGroup = useMemo(() =>
    filterGroupId ? baseByModule.filter(e => String(e.group_id) === filterGroupId) : baseByModule,
    [baseByModule, filterGroupId]);

  const filterAvailableClasses = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of baseByGroup) if (e.class_id) seen.set(e.class_id, e.class_name ?? "");
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [baseByGroup]);

  const filterAvailableCourses = useMemo(() =>
    filterLevel ? courses.filter(c => String(c.level) === filterLevel) : courses,
    [courses, filterLevel]);

  // ── Filas filtradas ───────────────────────────────────────────────────────

  const filteredGridRows = useMemo(() =>
    gridRows.filter(row => {
      if (filterLevel    && String(row.classLevel) !== filterLevel)    return false;
      if (filterModuleId && String(row.moduleId)   !== filterModuleId) return false;
      if (filterGroupId  && String(row.groupId)    !== filterGroupId)  return false;
      if (filterClassId  && String(row.classId)    !== filterClassId)  return false;
      if (filterCourseId && String(row.courseId)   !== filterCourseId) return false;
      return true;
    }),
    [gridRows, filterLevel, filterModuleId, filterGroupId, filterClassId, filterCourseId]
  );

  // ── Edición inline ────────────────────────────────────────────────────────

  function startEdit(row: GridRow) {
    if (row.scheduleId !== null) {
      setEditing(prev => ({
        ...prev,
        [row.rowKey]: {
          fecha_ini:        toDatetimeLocal(row.fechaIni),
          fecha_fin:        toDatetimeLocal(row.fechaFin),
          fecha_limite_ver: toDatetimeLocal(row.fechaLimiteVer ?? row.fechaFin),
          courseId:         String(row.courseId ?? ""),
        },
      }));
    } else {
      const { fechaIni, fechaFin, fechaLimiteVer } = defaultColombiaDates();
      setEditing(prev => ({
        ...prev,
        [row.rowKey]: { fecha_ini: fechaIni, fecha_fin: fechaFin, fecha_limite_ver: fechaLimiteVer, courseId: "" },
      }));
    }
  }

  function cancelEdit(rowKey: string) {
    setEditing(prev => { const n = { ...prev }; delete n[rowKey]; return n; });
  }

  async function saveDates(rowKey: string, row: GridRow) {
    const e = editing[rowKey];
    if (!e) return;
    setSaving(prev => ({ ...prev, [rowKey]: true }));
    try {
      if (row.scheduleId !== null) {
        await apiFetch(`/api/admin/exam-schedules/${row.scheduleId}`, {
          method: "PATCH",
          body: JSON.stringify({
            fecha_ini:        fromDatetimeLocal(e.fecha_ini),
            fecha_fin:        fromDatetimeLocal(e.fecha_fin),
            fecha_limite_ver: fromDatetimeLocal(e.fecha_limite_ver),
          }),
        });
      } else {
        if (!e.courseId) { setErrMsg("Selecciona un curso"); setSaving(prev => ({ ...prev, [rowKey]: false })); return; }
        const selectedCourse = courses.find(c => String(c.id) === e.courseId);
        const year = selectedCourse?.year ? Number(selectedCourse.year) : new Date().getFullYear();
        await apiFetch("/api/admin/exam-schedules", {
          method: "POST",
          body: JSON.stringify({
            id_evaluation:    row.examId,
            id_course:        Number(e.courseId),
            year,
            fecha_ini:        fromDatetimeLocal(e.fecha_ini),
            fecha_fin:        fromDatetimeLocal(e.fecha_fin),
            fecha_limite_ver: fromDatetimeLocal(e.fecha_limite_ver) || fromDatetimeLocal(e.fecha_fin),
            habilitado:       false,
          }),
        });
      }
      cancelEdit(rowKey);
      await loadSchedules();
      flash("Fechas guardadas");
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error guardando fechas");
    } finally {
      setSaving(prev => ({ ...prev, [rowKey]: false }));
    }
  }

  async function toggleHabilitado(row: GridRow) {
    if (!row.scheduleId) return;
    setToggling(prev => ({ ...prev, [row.rowKey]: true }));
    try {
      await apiFetch(`/api/admin/exam-schedules/${row.scheduleId}`, {
        method: "PATCH",
        body: JSON.stringify({ habilitado: !row.habilitado }),
      });
      await loadSchedules();
      flash(row.habilitado ? "Examen deshabilitado" : "Examen habilitado");
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error actualizando estado");
    } finally {
      setToggling(prev => ({ ...prev, [row.rowKey]: false }));
    }
  }

  async function deleteSchedule(row: GridRow) {
    if (!row.scheduleId) return;
    if (!confirm("¿Eliminar esta programación?")) return;
    try {
      await apiFetch(`/api/admin/exam-schedules/${row.scheduleId}`, { method: "DELETE" });
      await loadSchedules();
      flash("Programación eliminada");
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error eliminando programación");
    }
  }

  // ── Modal intentos ────────────────────────────────────────────────────────

  async function openAttempts(row: GridRow) {
    if (!row.scheduleId || row.courseId === null) return;
    setAttemptsCtx({ id_evaluation: row.examId, id_course: row.courseId, title: row.examTitle, courseName: row.courseName ?? "—" });
    setAttempts([]);
    setAttemptsLoading(true);
    try {
      const r = await apiFetch<{ items?: AttemptItem[] }>(
        `/api/admin/exam-attempts?id_evaluation=${row.examId}&id_course=${row.courseId}`
      );
      setAttempts(r?.items || []);
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error cargando intentos");
    } finally {
      setAttemptsLoading(false);
    }
  }

  async function handleReset(idStudent: string) {
    if (!attemptsCtx) return;
    setResetting(prev => ({ ...prev, [idStudent]: true }));
    try {
      await apiFetch("/api/admin/exam-attempts", {
        method: "DELETE",
        body: JSON.stringify({ id_student: idStudent, id_evaluation: attemptsCtx.id_evaluation }),
      });
      flash("Intento reiniciado");
      const r = await apiFetch<{ items?: AttemptItem[] }>(
        `/api/admin/exam-attempts?id_evaluation=${attemptsCtx.id_evaluation}&id_course=${attemptsCtx.id_course}`
      );
      setAttempts(r?.items || []);
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error reiniciando intento");
    } finally {
      setResetting(prev => ({ ...prev, [idStudent]: false }));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Agendar Exámenes</h2>
      </div>

      {errMsg && <div className="msgError" style={{ marginBottom: 12 }}>{errMsg}</div>}
      {okMsg  && <div className="msgOk"    style={{ marginBottom: 12 }}>{okMsg}</div>}

      {/* ── Card de filtros siempre visible ── */}
      <div className="card" style={{ marginBottom: 20, background: "color-mix(in srgb, var(--card) 60%, var(--bg))" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <div>
            <div className="label">Nivel</div>
            <select className="select" value={filterLevel} onChange={e => {
              setFilterLevel(e.target.value);
              setFilterModuleId(""); setFilterGroupId(""); setFilterClassId(""); setFilterCourseId("");
            }}>
              <option value="">Todos</option>
              {levels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <div className="label">Módulo</div>
            <select className="select" value={filterModuleId} onChange={e => {
              setFilterModuleId(e.target.value);
              setFilterGroupId(""); setFilterClassId("");
            }}>
              <option value="">Todos</option>
              {filterAvailableModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <div className="label">Grupo</div>
            <select className="select" value={filterGroupId} onChange={e => {
              setFilterGroupId(e.target.value);
              setFilterClassId("");
            }}>
              <option value="">Todos</option>
              {filterAvailableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <div className="label">Materia</div>
            <select className="select" value={filterClassId} onChange={e => setFilterClassId(e.target.value)}>
              <option value="">Todas</option>
              {filterAvailableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div className="label">Curso</div>
            <select className="select" value={filterCourseId} onChange={e => setFilterCourseId(e.target.value)}>
              <option value="">Todos</option>
              {filterAvailableCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Grilla ── */}
      {loading ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>
      ) : filteredGridRows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No hay exámenes.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--stroke)", textAlign: "left" }}>
                {["Módulo","Materia","Examen","Curso","Desde","Hasta","Estado","Límite revisión","Acciones"].map((h, i) => (
                  <th key={h} style={{
                    padding: "8px 10px", fontWeight: (i === 4 || i === 5) ? 400 : 600, fontSize: 13, whiteSpace: "nowrap",
                    ...(i === 3 ? { textAlign: "center" } : {}),
                    ...(i >= 4 && i <= 6 ? { background: "var(--group-col-bg-th)", color: "var(--group-col-text)" } : {}),
                    ...(i === 4 || i === 7 ? { borderLeft: "1px solid rgba(0,0,0,0.15)" } : {}),
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredGridRows.map((row, idx) => {
                const ed         = editing[row.rowKey];
                const isSaving   = !!saving[row.rowKey];
                const isToggling = !!toggling[row.rowKey];
                const isNew      = row.scheduleId === null;
                const rowBg      = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--stroke) 30%, transparent)";

                return (
                  <tr key={row.rowKey} style={{ background: rowBg, verticalAlign: "middle", opacity: isNew && !ed ? 0.7 : 1 }}>
                    <td style={{ padding: "8px 10px" }}>{row.moduleName ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{row.className  ?? "—"}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 500 }}>{row.examTitle}</td>

                    {/* Curso */}
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", textAlign: "center" }}>
                      {ed && isNew ? (
                        <select
                          className="select"
                          style={{ fontSize: 12, padding: "3px 6px" }}
                          value={ed.courseId}
                          onChange={v => setEditing(prev => ({ ...prev, [row.rowKey]: { ...prev[row.rowKey], courseId: v.target.value } }))}
                        >
                          <option value="">Seleccionar...</option>
                          {courses.filter(c => row.classLevel == null || c.level === row.classLevel).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        row.courseName ?? <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>

                    {/* Desde */}
                    <td style={{ padding: "6px 10px", fontWeight: 400, fontSize: 12, background: "var(--group-col-bg)", borderLeft: "1px solid rgba(0,0,0,0.15)" }}>
                      {ed ? (
                        <DateField value={ed.fecha_ini}
                          onChange={v => setEditing(prev => ({ ...prev, [row.rowKey]: { ...prev[row.rowKey], fecha_ini: v } }))} />
                      ) : <FmtDate iso={row.fechaIni} />}
                    </td>

                    {/* Hasta */}
                    <td style={{ padding: "6px 10px", fontWeight: 400, fontSize: 12, background: "var(--group-col-bg)" }}>
                      {ed ? (
                        <DateField value={ed.fecha_fin}
                          onChange={v => {
                            setEditing(prev => ({
                              ...prev,
                              [row.rowKey]: { ...prev[row.rowKey], fecha_fin: v, fecha_limite_ver: v ? addDaysToLocal(v, 15) : prev[row.rowKey].fecha_limite_ver },
                            }));
                          }} />
                      ) : <FmtDate iso={row.fechaFin} />}
                    </td>

                    {/* Toggle habilitado */}
                    <td style={{ padding: "6px 10px", background: "var(--group-col-bg)" }}>
                      {!isNew ? (
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: isToggling ? "wait" : "pointer" }}>
                          <input type="checkbox"
                            checked={row.habilitado}
                            disabled={isToggling}
                            onChange={() => toggleHabilitado(row)}
                            style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "inherit" }}
                          />
                          <span style={{ fontSize: 12, color: row.habilitado ? "#16a34a" : "var(--muted)" }}>
                            {row.habilitado ? "Habilitado" : "Deshabilitado"}
                          </span>
                        </label>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>Sin agendar</span>
                      )}
                    </td>

                    {/* Límite revisión */}
                    <td style={{ padding: "6px 10px", fontWeight: 400, fontSize: 12, borderLeft: "1px solid rgba(0,0,0,0.15)" }}>
                      {ed ? (
                        <DateField value={ed.fecha_limite_ver}
                          onChange={v => setEditing(prev => ({ ...prev, [row.rowKey]: { ...prev[row.rowKey], fecha_limite_ver: v } }))} />
                      ) : <FmtDate iso={row.fechaLimiteVer} />}
                    </td>

                    {/* Acciones */}
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                      {ed ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn" style={{ fontSize: 12, fontWeight: 400, padding: "4px 10px" }}
                            onClick={() => saveDates(row.rowKey, row)} disabled={isSaving}>
                            {isSaving ? "..." : "Guardar"}
                          </button>
                          <button className="btn"
                            style={{ fontSize: 12, fontWeight: 400, padding: "4px 10px", background: "var(--card)", color: "var(--text)", border: "1px solid var(--stroke)" }}
                            onClick={() => cancelEdit(row.rowKey)} disabled={isSaving}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn"
                            style={{ fontSize: 12, fontWeight: 400, padding: "5px 10px", background: "#374151", color: "#f9fafb", border: "1px solid #374151" }}
                            onClick={() => startEdit(row)}>
                            {isNew ? "Agendar" : "Editar fechas"}
                          </button>
                          {!isNew && (
                            <>
                              <button className="btn"
                                style={{ fontSize: 12, fontWeight: 400, padding: "5px 10px", background: "#374151", color: "#f9fafb", border: "1px solid #374151" }}
                                onClick={() => openAttempts(row)}>
                                Intentos
                              </button>
                              <button className="btn"
                                style={{ fontSize: 12, fontWeight: 400, padding: "1px 10px", background: "#dc2626", color: "#fff", border: "1px solid #dc2626" }}
                                onClick={() => deleteSchedule(row)}>
                                Eliminar
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal: intentos de estudiantes ── */}
      {attemptsCtx && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "90%", maxWidth: 560, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>Intentos — {attemptsCtx.title}</h3>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Curso: {attemptsCtx.courseName}</span>
              </div>
              <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--muted)", lineHeight: 1 }}
                onClick={() => setAttemptsCtx(null)}>×</button>
            </div>

            {attemptsLoading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>}
            {!attemptsLoading && attempts.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>Ningún estudiante ha presentado este examen.</p>
            )}
            {!attemptsLoading && attempts.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--stroke)", textAlign: "left" }}>
                    {["Cédula","Nombre","Calificación","Fecha",""].map(h => (
                      <th key={h} style={{ padding: "6px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a, idx) => (
                    <tr key={a.id_student}
                      style={{ background: idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--stroke) 30%, transparent)" }}>
                      <td style={{ padding: "6px 10px" }}>{a.cedula}</td>
                      <td style={{ padding: "6px 10px" }}>{a.name}</td>
                      <td style={{ padding: "6px 10px", fontWeight: 600,
                        color: a.calificacion != null ? (a.calificacion >= 70 ? "#16a34a" : "#dc2626") : "var(--muted)" }}>
                        {a.calificacion != null ? a.calificacion.toFixed(2) : "—"}
                      </td>
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "var(--muted)" }}>
                        <FmtDate iso={a.finalizado_at} />
                      </td>
                      <td style={{ padding: "6px 10px" }}>
                        <button
                          style={{ fontSize: 12, padding: "3px 10px", background: "none", border: "1px solid #dc2626", borderRadius: 6, color: "#dc2626", cursor: resetting[a.id_student] ? "wait" : "pointer" }}
                          disabled={!!resetting[a.id_student]}
                          onClick={() => handleReset(a.id_student)}>
                          {resetting[a.id_student] ? "..." : "Reiniciar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button className="btn"
                style={{ padding: "8px 20px", background: "var(--card)", color: "var(--text)", border: "1px solid var(--stroke)" }}
                onClick={() => setAttemptsCtx(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
