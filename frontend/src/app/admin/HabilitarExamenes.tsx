"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Course = { id: number; name: string; level: number; year: string | null };

type LevelMini = { id: number; name: string };

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

type AttemptItem = {
  id_student: string;
  name: string;
  cedula: string;
  calificacion: number | null;
  finalizado_at: string | null;
};

interface Props {
  courses: Course[];
}

// ─── Helpers (hora Colombia UTC-5) ────────────────────────────────────────────

const COL_OFFSET_MS = -5 * 60 * 60 * 1000; // UTC-5, sin horario de verano

// UTC ISO → string "YYYY-MM-DDTHH:MM" en hora Colombia (para datetime-local)
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const colMs = new Date(iso).getTime() + COL_OFFSET_MS;
  return new Date(colMs).toISOString().slice(0, 16);
}

// string "YYYY-MM-DDTHH:MM" en hora Colombia → UTC ISO para la API
function fromDatetimeLocal(val: string): string | null {
  if (!val) return null;
  const [datePart, timePart] = val.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min] = timePart.split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h, min) - COL_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

// Suma días a un string Colombia datetime-local y devuelve otro string Colombia
function addDaysToLocal(val: string, days: number): string {
  if (!val) return "";
  const utcIso = fromDatetimeLocal(val);
  if (!utcIso) return "";
  return toDatetimeLocal(new Date(new Date(utcIso).getTime() + days * 24 * 60 * 60 * 1000).toISOString());
}

// Formatea UTC ISO para mostrar en hora Colombia: 05-MAY-2026  02:20 pm
const MESES = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function fmtColombiaParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/Bogota" }));
  const day  = String(d.getDate()).padStart(2, "0");
  const mon  = MESES[d.getMonth()];
  const year = d.getFullYear();
  const hh   = d.getHours();
  const mm   = String(d.getMinutes()).padStart(2, "0");
  const h12  = String(hh % 12 || 12).padStart(2, "0");
  const ampm = hh < 12 ? "am" : "pm";
  return { date: `${day}-${mon}-${year}`, time: `${h12}:${mm} ${ampm}` };
}
function _fmtColombia(iso: string | null): string {
  const { date, time } = fmtColombiaParts(iso);
  return time ? `${date}  ${time}` : date;
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

// Input datetime-local oculto con display formateado encima
function DateField({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.click(); }
  }

  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div
        onClick={openPicker}
        style={{
          fontSize: 12, fontWeight: 400, padding: "3px 28px 3px 6px", border: "1px solid var(--stroke)",
          borderRadius: 6, background: "var(--input-bg, var(--card))", color: "var(--text)",
          whiteSpace: "nowrap", cursor: "pointer", minWidth: 160,
        }}>
        <span style={{ flex: 1 }}>{value ? <FmtDate iso={fromDatetimeLocal(value)} /> : "—"}</span>
        <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 13, pointerEvents: "none", opacity: 0.55 }}>📅</span>
      </div>
      <input
        ref={inputRef}
        type="datetime-local"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0, top: 0, left: 0 }}
      />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HabilitarExamenes({ courses }: Props) {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [allExams,  setAllExams]  = useState<ExamMini[]>([]);
  const [levels,    setLevels]    = useState<LevelMini[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);
  const [okMsg,     setOkMsg]     = useState<string | null>(null);

  // Modal de intentos
  const [attemptsSchedule, setAttemptsSchedule] = useState<ScheduleItem | null>(null);
  const [attempts,         setAttempts]         = useState<AttemptItem[]>([]);
  const [attemptsLoading,  setAttemptsLoading]  = useState(false);
  const [resetting,        setResetting]        = useState<Record<string, boolean>>({});

  // Estado de edición inline por fila
  const [editing,  setEditing]  = useState<Record<number, { fecha_ini: string; fecha_fin: string; fecha_limite_ver: string }>>({});
  const [saving,   setSaving]   = useState<Record<number, boolean>>({});
  const [toggling, setToggling] = useState<Record<number, boolean>>({});

  // Formulario nueva programación
  const [showForm,    setShowForm]    = useState(false);
  const [fLevel,      setFLevel]      = useState<string>("");
  const [fModuleId,   setFModuleId]   = useState<string>("");
  const [fGroupId,    setFGroupId]    = useState<string>("");
  const [fClassId,    setFClassId]    = useState<string>("");
  const [fExamId,     setFExamId]     = useState<string>("");
  const [fCourseId,   setFCourseId]   = useState<string>("");
  const [fFechaIni,   setFFechaIni]   = useState<string>("");
  const [fFechaFin,   setFFechaFin]   = useState<string>("");
  const [fFechaLimiteVer,   setFFechaVer]   = useState<string>("");
  const [fHabilitado, setFHabilitado] = useState(false);
  const [formSaving,  setFormSaving]  = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

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

  type ExamApiItem = { id: number; title: string; module?: { id: number; name: string }; group?: { id: number; name: string }; class?: { id: number; name: string; level: number } };
  async function loadExams() {
    try {
      const r = await apiFetch<{ items?: ExamApiItem[] }>("/api/admin/exams");
      const items: ExamMini[] = (r?.items || []).map((ev) => ({
        id:          ev.id,
        title:       ev.title,
        module_id:   ev.module?.id   ?? null,
        module_name: ev.module?.name ?? null,
        group_id:    ev.group?.id    ?? null,
        group_name:  ev.group?.name  ?? null,
        class_id:    ev.class?.id    ?? null,
        class_name:  ev.class?.name  ?? null,
        class_level: ev.class?.level ?? null,
      }));
      setAllExams(items);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showForm) return;
    // Trabajar siempre en hora Colombia (UTC-5)
    const colMs = Date.now() + COL_OFFSET_MS;
    const colNow = new Date(colMs);
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

    setFFechaIni(fmt(colNow));

    const dayOfWeek = colNow.getUTCDay();
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
    const sundayCol = new Date(colMs + daysUntilSunday * 24 * 60 * 60 * 1000);
    sundayCol.setUTCHours(23, 59, 0, 0);
    setFFechaFin(fmt(sundayCol));

    const verCol = new Date(sundayCol.getTime() + 15 * 24 * 60 * 60 * 1000);
    setFFechaVer(fmt(verCol));
  }, [showForm]);

  function flash(ok: string) {
    setOkMsg(ok);
    setTimeout(() => setOkMsg(null), 3500);
  }

  // ── Cascade derived data ─────────────────────────────────────────────────────

  const examsByLevel = useMemo(() =>
    fLevel ? allExams.filter(e => e.class_level === null || String(e.class_level) === fLevel) : allExams,
    [allExams, fLevel]);

  const availableModules = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of examsByLevel) if (e.module_id) seen.set(e.module_id, e.module_name ?? "");
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [examsByLevel]);

  const examsByModule = useMemo(() =>
    fModuleId ? examsByLevel.filter(e => String(e.module_id) === fModuleId) : examsByLevel,
    [examsByLevel, fModuleId]);

  const availableGroups = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of examsByModule) if (e.group_id) seen.set(e.group_id, e.group_name ?? "");
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [examsByModule]);

  const examsByGroup = useMemo(() =>
    fGroupId ? examsByModule.filter(e => String(e.group_id) === fGroupId) : examsByModule,
    [examsByModule, fGroupId]);

  const availableClasses = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of examsByGroup) if (e.class_id) seen.set(e.class_id, e.class_name ?? "");
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [examsByGroup]);

  const filteredExams = useMemo(() =>
    fClassId ? examsByGroup.filter(e => String(e.class_id) === fClassId) : examsByGroup,
    [examsByGroup, fClassId]);

  const filteredCourses = useMemo(() =>
    fLevel ? courses.filter(c => String(c.level) === fLevel) : courses,
    [courses, fLevel]);

  // ── Inline edit ─────────────────────────────────────────────────────────────

  function startEdit(s: ScheduleItem) {
    setEditing(prev => ({
      ...prev,
      [s.id]: {
        fecha_ini: toDatetimeLocal(s.fecha_ini),
        fecha_fin: toDatetimeLocal(s.fecha_fin),
        fecha_limite_ver: toDatetimeLocal(s.fecha_limite_ver ?? s.fecha_fin),
      },
    }));
  }

  function cancelEdit(id: number) {
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  async function saveDates(id: number) {
    const e = editing[id];
    if (!e) return;
    setSaving(prev => ({ ...prev, [id]: true }));
    try {
      await apiFetch(`/api/admin/exam-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fecha_ini: fromDatetimeLocal(e.fecha_ini),
          fecha_fin: fromDatetimeLocal(e.fecha_fin),
          fecha_limite_ver: fromDatetimeLocal(e.fecha_limite_ver),
        }),
      });
      cancelEdit(id);
      await loadSchedules();
      flash("Fechas actualizadas");
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error guardando fechas");
    } finally {
      setSaving(prev => ({ ...prev, [id]: false }));
    }
  }

  async function toggleHabilitado(s: ScheduleItem) {
    setToggling(prev => ({ ...prev, [s.id]: true }));
    try {
      await apiFetch(`/api/admin/exam-schedules/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ habilitado: !s.habilitado }),
      });
      await loadSchedules();
      flash(s.habilitado ? "Examen deshabilitado" : "Examen habilitado");
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error actualizando estado");
    } finally {
      setToggling(prev => ({ ...prev, [s.id]: false }));
    }
  }

  async function deleteSchedule(id: number) {
    if (!confirm("¿Eliminar esta programación?")) return;
    try {
      await apiFetch(`/api/admin/exam-schedules/${id}`, { method: "DELETE" });
      await loadSchedules();
      flash("Programación eliminada");
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error eliminando programación");
    }
  }

  // ── Modal intentos ──────────────────────────────────────────────────────────

  async function openAttempts(s: ScheduleItem) {
    setAttemptsSchedule(s);
    setAttempts([]);
    setAttemptsLoading(true);
    try {
      const r = await apiFetch<{ items?: AttemptItem[] }>(
        `/api/admin/exam-attempts?id_evaluation=${s.id_evaluation}&id_course=${s.id_course}`
      );
      setAttempts(r?.items || []);
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error cargando intentos");
    } finally {
      setAttemptsLoading(false);
    }
  }

  async function handleReset(idStudent: string, idEvaluation: number, idCourse: number) {
    setResetting(prev => ({ ...prev, [idStudent]: true }));
    try {
      await apiFetch("/api/admin/exam-attempts", {
        method: "DELETE",
        body: JSON.stringify({ id_student: idStudent, id_evaluation: idEvaluation }),
      });
      flash("Intento reiniciado");
      const r = await apiFetch<{ items?: AttemptItem[] }>(
        `/api/admin/exam-attempts?id_evaluation=${idEvaluation}&id_course=${idCourse}`
      );
      setAttempts(r?.items || []);
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error reiniciando intento");
    } finally {
      setResetting(prev => ({ ...prev, [idStudent]: false }));
    }
  }

  // ── Nueva programación ───────────────────────────────────────────────────────

  function resetForm() {
    setFLevel(""); setFModuleId(""); setFGroupId(""); setFClassId("");
    setFExamId(""); setFCourseId("");
    setFFechaIni(""); setFFechaFin(""); setFFechaVer("");
    setFHabilitado(false);
    setShowForm(false);
  }

  async function handleCreate() {
    setErrMsg(null);
    if (!fExamId)   return setErrMsg("Selecciona un examen");
    if (!fCourseId) return setErrMsg("Selecciona un curso");
    const selectedCourse = courses.find(c => String(c.id) === fCourseId);
    const year = selectedCourse?.year ? Number(selectedCourse.year) : new Date().getFullYear();
    setFormSaving(true);
    try {
      await apiFetch("/api/admin/exam-schedules", {
        method: "POST",
        body: JSON.stringify({
          id_evaluation: Number(fExamId),
          id_course:     Number(fCourseId),
          year,
          fecha_ini:     fromDatetimeLocal(fFechaIni),
          fecha_fin:     fromDatetimeLocal(fFechaFin),
          fecha_limite_ver:     fromDatetimeLocal(fFechaLimiteVer || fFechaFin),
          habilitado:    fHabilitado,
        }),
      });
      resetForm();
      await loadSchedules();
      flash("Programación creada");
    } catch (ex) {
      setErrMsg((ex as { message?: string })?.message || "Error creando programación");
    } finally {
      setFormSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const _selectStyle = { fontSize: 12, padding: "3px 6px" };

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Habilitar Exámenes</h2>
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>
            • Lógica de fechas:    [Desde]→ Tomar Examen ←[Hasta+check]→ Ver Examen ←[Límite revisión]→ Cerrado
          </span>
        </div>
        {!showForm && (
          <button className="btn" style={{ padding: "8px 18px" }} onClick={() => setShowForm(true)}>
            + Nueva Programación
          </button>
        )}
      </div>

      {errMsg && <div className="msgError" style={{ marginBottom: 12 }}>{errMsg}</div>}
      {okMsg  && <div className="msgOk"    style={{ marginBottom: 12 }}>{okMsg}</div>}

      {/* ── Formulario nueva programación ── */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20, background: "color-mix(in srgb, var(--card) 60%, var(--bg))" }}>
          <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 15 }}>Nueva Programación</h3>

          {/* Fila 1 — Nivel / Módulo / Grupo / Materia */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div className="label">Nivel</div>
              <select className="select" value={fLevel} onChange={e => {
                setFLevel(e.target.value);
                setFModuleId(""); setFGroupId(""); setFClassId(""); setFExamId(""); setFCourseId("");
              }}>
                <option value="">Todos</option>
                {levels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div style={{ opacity: !fLevel ? 0.4 : 1, pointerEvents: !fLevel ? "none" : "auto" }}>
              <div className="label">Módulo</div>
              <select className="select" value={fModuleId} onChange={e => {
                setFModuleId(e.target.value);
                setFGroupId(""); setFClassId(""); setFExamId("");
              }}>
                <option value="">Todos</option>
                {availableModules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ opacity: !fLevel ? 0.4 : 1, pointerEvents: !fLevel ? "none" : "auto" }}>
              <div className="label">Grupo</div>
              <select className="select" value={fGroupId} onChange={e => {
                setFGroupId(e.target.value);
                setFClassId(""); setFExamId("");
              }}>
                <option value="">Todos</option>
                {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div style={{ opacity: !fLevel ? 0.4 : 1, pointerEvents: !fLevel ? "none" : "auto" }}>
              <div className="label">Materia</div>
              <select className="select" value={fClassId} onChange={e => {
                setFClassId(e.target.value);
                setFExamId("");
              }}>
                <option value="">Todas</option>
                {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Fila 2 — Examen / Curso / Habilitar */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, alignItems: "end", marginBottom: 12 }}>
            <div style={{ gridColumn: "1 / 3" }}>
              <div className="label">Examen</div>
              <select className="select" value={fExamId} onChange={e => setFExamId(e.target.value)}>
                <option value="">Seleccionar examen...</option>
                {filteredExams.map(ex => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}{ex.class_name ? ` — ${ex.class_name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "3" }}>
              <div className="label">Curso</div>
              <select className="select" value={fCourseId} onChange={e => setFCourseId(e.target.value)}>
                <option value="">Seleccionar curso...</option>
                {filteredCourses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "4", paddingBottom: 11, display: "flex", justifyContent: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={fHabilitado} onChange={e => setFHabilitado(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#16a34a" }} />
                Habilitar inmediatamente
              </label>
            </div>
          </div>

          {/* Fila 3 — Fechas */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <div className="label">Desde</div>
              <input type="datetime-local" className="input" value={fFechaIni}
                onChange={e => setFFechaIni(e.target.value)}
                onDoubleClick={e => { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }} />
            </div>
            <div>
              <div className="label">Hasta</div>
              <input type="datetime-local" className="input" value={fFechaFin}
                onChange={e => {
                  setFFechaFin(e.target.value);
                  if (e.target.value) {
                    setFFechaVer(addDaysToLocal(e.target.value, 15));
                  }
                }}
                onDoubleClick={e => { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }} />
            </div>
            <div>
              <div className="label">Límite revisión</div>
              <input type="datetime-local" className="input" value={fFechaLimiteVer}
                onChange={e => setFFechaVer(e.target.value)}
                onDoubleClick={e => { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }} />
            </div>
          </div>

          {/* Fila 4 — Botones */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn"
              style={{ background: "var(--card)", color: "var(--text)", border: "1px solid var(--stroke)", padding: "8px 18px" }}
              onClick={resetForm} disabled={formSaving}>
              Cancelar
            </button>
            <button className="btn" style={{ padding: "8px 18px" }} onClick={handleCreate} disabled={formSaving}>
              {formSaving ? "Guardando..." : "Crear Programación"}
            </button>
          </div>
        </div>
      )}

      {/* ── Grilla de programaciones ── */}
      {loading ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>
      ) : schedules.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No hay programaciones registradas.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--stroke)", textAlign: "left" }}>
                {["Módulo","Materia","Examen","Curso","Desde","Hasta","Estado","Límite revisión","Acciones"].map((h, i) => (
                  <th key={h} style={{ padding: "8px 10px", fontWeight: (i === 4 || i === 5) ? 400 : 600, fontSize: 13, whiteSpace: "nowrap", ...(i >= 4 && i <= 6 ? { background: "var(--group-col-bg-th)", color: "var(--group-col-text)" } : {}), ...(i === 4 || i === 7 ? { borderLeft: "1px solid rgba(0,0,0,0.15)" } : {}) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s, idx) => {
                const ed = editing[s.id];
                const isSaving   = !!saving[s.id];
                const isToggling = !!toggling[s.id];
                const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--stroke) 30%, transparent)";
                return (
                  <tr key={s.id} style={{ background: rowBg, verticalAlign: "middle" }}>
                    <td style={{ padding: "8px 10px" }}>{s.evaluation?.module?.name ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{s.evaluation?.class?.name  ?? "—"}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 500 }}>{s.evaluation?.title ?? "—"}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{s.course?.name ?? "—"}</td>

                    {/* Desde */}
                    <td style={{ padding: "6px 10px", fontWeight: 400, fontSize: 12, background: "var(--group-col-bg)", borderLeft: "1px solid rgba(0,0,0,0.15)" }}>
                      {ed ? (
                        <DateField value={ed.fecha_ini}
                          onChange={v => setEditing(prev => ({ ...prev, [s.id]: { ...prev[s.id], fecha_ini: v } }))} />
                      ) : (
                        <FmtDate iso={s.fecha_ini} />
                      )}
                    </td>

                    {/* Hasta */}
                    <td style={{ padding: "6px 10px", fontWeight: 400, fontSize: 12, background: "var(--group-col-bg)" }}>
                      {ed ? (
                        <DateField value={ed.fecha_fin}
                          onChange={v => setEditing(prev => ({ ...prev, [s.id]: { ...prev[s.id], fecha_fin: v } }))} />
                      ) : (
                        <FmtDate iso={s.fecha_fin} />
                      )}
                    </td>

                    {/* Toggle habilitado */}
                    <td style={{ padding: "6px 10px", background: "var(--group-col-bg)" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: isToggling ? "wait" : "pointer" }}>
                        <input type="checkbox"
                          checked={s.habilitado}
                          disabled={isToggling}
                          onChange={() => toggleHabilitado(s)}
                          style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "inherit" }}
                        />
                        <span style={{ fontSize: 12, color: s.habilitado ? "#16a34a" : "var(--muted)" }}>
                          {s.habilitado ? "Habilitado" : "Deshabilitado"}
                        </span>
                      </label>
                    </td>

                    {/* Límite revisión */}
                    <td style={{ padding: "6px 10px", fontWeight: 400, fontSize: 12, borderLeft: "1px solid rgba(0,0,0,0.15)" }}>
                      {ed ? (
                        <DateField value={ed.fecha_limite_ver}
                          onChange={v => setEditing(prev => ({ ...prev, [s.id]: { ...prev[s.id], fecha_limite_ver: v } }))} />
                      ) : (
                        <FmtDate iso={s.fecha_limite_ver} />
                      )}
                    </td>

                    {/* Acciones */}
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                      {ed ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn" style={{ fontSize: 12, fontWeight: 400, padding: "4px 10px" }}
                            onClick={() => saveDates(s.id)} disabled={isSaving}>
                            {isSaving ? "..." : "Guardar"}
                          </button>
                          <button className="btn"
                            style={{ fontSize: 12, fontWeight: 400, padding: "4px 10px", background: "var(--card)", color: "var(--text)", border: "1px solid var(--stroke)" }}
                            onClick={() => cancelEdit(s.id)} disabled={isSaving}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn"
                            style={{ fontSize: 12, fontWeight: 400, padding: "5px 10px", background: "#374151", color: "#f9fafb", border: "1px solid #374151" }}
                            onClick={() => startEdit(s)}>
                            Editar fechas
                          </button>
                          <button className="btn"
                            style={{ fontSize: 12, fontWeight: 400, padding: "5px 10px", background: "#374151", color: "#f9fafb", border: "1px solid #374151" }}
                            onClick={() => openAttempts(s)}>
                            Intentos
                          </button>
                          <button className="btn"
                            style={{ fontSize: 12, fontWeight: 400, padding: "1px 10px", background: "#dc2626", color: "#fff", border: "1px solid #dc2626" }}
                            onClick={() => deleteSchedule(s.id)}>
                            Eliminar
                          </button>
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
      {attemptsSchedule && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="card" style={{ width: "90%", maxWidth: 560, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 4px" }}>Intentos — {attemptsSchedule.evaluation?.title}</h3>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Curso: {attemptsSchedule.course?.name}
                </span>
              </div>
              <button
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--muted)", lineHeight: 1 }}
                onClick={() => setAttemptsSchedule(null)}>×</button>
            </div>

            {attemptsLoading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Cargando...</p>}

            {!attemptsLoading && attempts.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>Ningún estudiante ha presentado este examen.</p>
            )}

            {!attemptsLoading && attempts.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--stroke)", textAlign: "left" }}>
                    {["Cédula", "Nombre", "Calificación", "Fecha", ""].map(h => (
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
                          onClick={() => handleReset(a.id_student, attemptsSchedule.id_evaluation, attemptsSchedule.id_course)}>
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
                onClick={() => setAttemptsSchedule(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
