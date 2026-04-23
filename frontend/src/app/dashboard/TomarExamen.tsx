"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { seededShuffle } from "@/lib/shuffleUtils";

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoPregunta = "multiple_multi" | "multiple_single" | "falso_verdadero" | "emparejamiento";

type OpcionItem = { id: string; texto: string };
type OpcionesEmparejamiento = { izquierda: OpcionItem[]; derecha: OpcionItem[] };
type RespuestaEstudiante = string[] | Record<string, string> | null;

type Pregunta = {
  id: number;
  orden: number;
  tipo: TipoPregunta;
  enunciado: string;
  puntos: number;
  opciones: OpcionItem[] | OpcionesEmparejamiento | null;
};

export type ExamAvailableItem = {
  id_programacion: number;
  id_evaluation: number;
  title: string;
  tiempo_minutos: number | null;
  class_id: number;
  class_name: string | null;
  module_name: string | null;
  fecha_ini: string;
  fecha_fin: string;
  fecha_limite_ver: string | null;
  ya_rendido: boolean;
  finalizado_at: string | null;
};

type Phase =
  | "loading"
  | "ready"
  | "starting"
  | "active"
  | "timeout_modal"
  | "submitting"
  | "ya_rendido"
  | "done";

interface Props {
  examInfo: ExamAvailableItem;
  me: Record<string, unknown>;
  onClose: (submitted?: boolean) => void;
  onFinished: (id_evaluation: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sc).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sc).padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TomarExamen({ examInfo, me, onClose, onFinished }: Props) {
  const [phase,        setPhase]        = useState<Phase>("loading");
  const [preguntas,    setPreguntas]    = useState<Pregunta[]>([]);
  const [errMsg,       setErrMsg]       = useState<string | null>(null);
  const [secondsLeft,  setSecondsLeft]  = useState(0);
  const [respuestas,   setRespuestas]   = useState<Record<number, RespuestaEstudiante>>({});
  const [currentIdx,   setCurrentIdx]   = useState(0);
  const [warnNoResp,   setWarnNoResp]   = useState(false);
  const [savingAnswer,     setSavingAnswer]     = useState(false);
  const [retomando,        setRetomando]        = useState(false); // true si se retoma un examen en curso
  const [calificacionFinal, setCalificacionFinal] = useState<number | null>(null);

  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const iniciadoAtRef = useRef<string | null>(null);
  const totalSecsRef  = useRef<number>(0);

  // Orden de columna derecha para emparejamiento — determinista por estudiante+examen+pregunta
  // para que VerExamen muestre las mismas letras que el estudiante vio al tomar el examen.
  const shuffledDerMap = useMemo(() => {
    const map = new Map<number, OpcionItem[]>();
    const user = me?.user as { id?: unknown } | undefined;
    const studentId = String(user?.id ?? "");
    for (const p of preguntas) {
      if (p.tipo === "emparejamiento") {
        const opc = p.opciones as OpcionesEmparejamiento | null;
        const arr = opc?.derecha ?? [];
        map.set(p.id, seededShuffle(arr, studentId, examInfo.id_evaluation, p.id));
      }
    }
    return map;
  }, [preguntas, me, examInfo.id_evaluation]);

  // ── Load exam on mount ──────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ preguntas?: Pregunta[]; iniciado_at?: string; respuestas_guardadas?: Array<{ id_pregunta: number; respuesta: RespuestaEstudiante }>; pregunta_actual?: number }>(`/api/student/exam/${examInfo.id_evaluation}`);
        setPreguntas(data.preguntas || []);

        const totalSecs = (examInfo.tiempo_minutos ?? 0) * 60;
        totalSecsRef.current = totalSecs;

        if (data.iniciado_at) {
          // Examen ya iniciado: restaurar timer, respuestas guardadas y posición
          iniciadoAtRef.current = data.iniciado_at;
          const elapsed   = (Date.now() - new Date(data.iniciado_at).getTime()) / 1000;
          const remaining = totalSecs - elapsed;

          // Restaurar respuestas guardadas
          if (Array.isArray(data.respuestas_guardadas) && data.respuestas_guardadas.length > 0) {
            const restored: Record<number, RespuestaEstudiante> = {};
            for (const r of data.respuestas_guardadas) {
              restored[Number(r.id_pregunta)] = r.respuesta;
            }
            setRespuestas(restored);
          }

          // Restaurar posición
          const savedIdx = data.pregunta_actual ?? 0;
          if (savedIdx > 0) {
            setCurrentIdx(savedIdx);
            setRetomando(true);
          }

          setSecondsLeft(Math.max(0, remaining));
          setPhase(remaining > 0 ? "active" : "timeout_modal");
        } else {
          setSecondsLeft(totalSecs);
          setPhase("ready");
        }
      } catch (e) {
        const msg = (e as { message?: string })?.message || "Error cargando examen";
        if (msg.toLowerCase().includes("ya has rendido")) {
          setPhase("ya_rendido");
        } else {
          setErrMsg(msg);
          setPhase("ready");
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Countdown timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== "active") {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      if (!iniciadoAtRef.current) return;
      const elapsed   = (Date.now() - new Date(iniciadoAtRef.current).getTime()) / 1000;
      const remaining = totalSecsRef.current - elapsed;
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        setSecondsLeft(0);
        setPhase("timeout_modal");
      } else {
        setSecondsLeft(remaining);
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleIniciar() {
    setErrMsg(null);
    setPhase("starting");
    try {
      const data = await apiFetch<{ iniciado_at: string }>(
        `/api/student/exam/${examInfo.id_evaluation}/start`,
        { method: "POST" }
      );
      iniciadoAtRef.current = data.iniciado_at;
      const total   = (examInfo.tiempo_minutos ?? 0) * 60;
      totalSecsRef.current  = total;
      const elapsed = (Date.now() - new Date(data.iniciado_at).getTime()) / 1000;
      setSecondsLeft(Math.max(0, total - elapsed));
      setPhase("active");
    } catch (e) {
      setErrMsg((e as { message?: string })?.message || "Error iniciando examen");
      setPhase("ready");
    }
  }

  async function handleSubmit() {
    setPhase("submitting");
    setErrMsg(null);
    try {
      const respArray = Object.entries(respuestas).map(([id_pregunta, respuesta]) => ({
        id_pregunta: Number(id_pregunta),
        respuesta,
      }));
      const result = await apiFetch<{ calificacion?: number }>(`/api/student/exam/${examInfo.id_evaluation}/submit`, {
        method: "POST",
        body: JSON.stringify({ respuestas: respArray }),
      });
      // Abrir revisión si estamos dentro de la ventana: fecha_fin < ahora ≤ fecha_limite_ver
      const now = new Date();
      const flv  = examInfo.fecha_limite_ver;
      const ffin = examInfo.fecha_fin;
      const enVentana = flv && ffin && now > new Date(ffin) && now <= new Date(flv);
      if (enVentana) {
        onFinished(examInfo.id_evaluation);
      } else {
        setCalificacionFinal(result?.calificacion ?? null);
        setPhase("done");
      }
    } catch (e) {
      const msg = (e as { message?: string })?.message || "Error enviando examen";
      if (msg.toLowerCase().includes("ya has rendido")) {
        setPhase("ya_rendido");
      } else {
        setErrMsg(msg);
        setPhase("active");
      }
    }
  }

  function setRespuesta(id: number, val: RespuestaEstudiante) {
    setWarnNoResp(false);
    setRespuestas((prev) => ({ ...prev, [id]: val }));
  }

  function hasRespuesta(p: Pregunta): boolean {
    const r = respuestas[p.id];
    if (p.tipo === "emparejamiento") {
      return typeof r === "object" && r !== null && !Array.isArray(r) && Object.keys(r).length > 0;
    }
    return Array.isArray(r) && r.length > 0;
  }

  async function handleSiguiente() {
    const p = preguntas[currentIdx];
    if (!hasRespuesta(p)) { setWarnNoResp(true); return; }
    setWarnNoResp(false);
    setSavingAnswer(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/student/exam/${examInfo.id_evaluation}/save-answer`, {
        method: "POST",
        body: JSON.stringify({
          id_pregunta:  p.id,
          respuesta:    respuestas[p.id],
          pregunta_idx: currentIdx + 1,
        }),
      });
      setRetomando(false);
      setCurrentIdx((i) => i + 1);
    } catch (e) {
      setErrMsg(((e as { message?: string })?.message || "Error guardando respuesta") + " — tu respuesta no se perdió, inténtalo de nuevo.");
    } finally {
      setSavingAnswer(false);
    }
  }

  // ── Per-type renderers ───────────────────────────────────────────────────────

  const disabled = phase !== "active";

  function renderMultiple(p: Pregunta, isMulti: boolean) {
    const opts: OpcionItem[] = Array.isArray(p.opciones) ? p.opciones as OpcionItem[] : [];
    const resp = respuestas[p.id];
    const selected: string[] = Array.isArray(resp) ? resp : [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {opts.map((op) => (
          <label key={op.id}
            style={{ display: "flex", alignItems: "center", gap: 10,
              cursor: disabled ? "default" : "pointer", fontSize: 14 }}>
            {isMulti ? (
              <input type="checkbox" disabled={disabled}
                checked={selected.includes(op.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, op.id]
                    : selected.filter((id) => id !== op.id);
                  setRespuesta(p.id, next);
                }}
                style={{ width: 16, height: 16, accentColor: "#16a34a", flexShrink: 0 }}
              />
            ) : (
              <input type="radio" disabled={disabled}
                name={`preg_${p.id}`}
                checked={selected[0] === op.id}
                onChange={() => setRespuesta(p.id, [op.id])}
                style={{ width: 16, height: 16, accentColor: "#16a34a", flexShrink: 0 }}
              />
            )}
            <span>{op.texto}</span>
          </label>
        ))}
      </div>
    );
  }

  function renderFV(p: Pregunta) {
    const resp = respuestas[p.id];
    const selected: string[] = Array.isArray(resp) ? resp : [];
    return (
      <div style={{ display: "flex", gap: 32 }}>
        {(["V", "F"] as const).map((val) => (
          <label key={val}
            style={{ display: "flex", alignItems: "center", gap: 8,
              cursor: disabled ? "default" : "pointer", fontSize: 14 }}>
            <input type="radio" disabled={disabled}
              name={`preg_${p.id}`}
              checked={selected[0] === val}
              onChange={() => setRespuesta(p.id, [val])}
              style={{ width: 16, height: 16, accentColor: "#16a34a" }}
            />
            {val === "V" ? "Verdadero" : "Falso"}
          </label>
        ))}
      </div>
    );
  }

  function renderEmparejamiento(p: Pregunta) {
    const opc = p.opciones as OpcionesEmparejamiento | null;
    const izq: OpcionItem[] = opc?.izquierda ?? [];
    const der: OpcionItem[] = shuffledDerMap.get(p.id) ?? (opc?.derecha ?? []);
    const resp = respuestas[p.id];
    const mapeo: Record<string, string> = (resp && !Array.isArray(resp)) ? resp : {};

    function handleSelect(izqId: string, newDerId: string) {
      const next = { ...mapeo };
      // Si la opción ya está asignada a otro ítem, liberar esa pareja
      if (newDerId) {
        for (const key of Object.keys(next)) {
          if (key !== izqId && next[key] === newDerId) delete next[key];
        }
      }
      next[izqId] = newDerId;
      setRespuesta(p.id, next);
    }

    const maxRows = Math.max(izq.length, der.length);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0fr 1fr", rowGap: 8, columnGap: 12, alignItems: "center", paddingLeft: 32 }}>
        {Array.from({ length: maxRows }).map((_, idx) => {
          const leftItem  = izq[idx];
          const rightItem = der[idx];
          return (
            <React.Fragment key={idx}>
              {/* Col 1 — texto izq */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                {leftItem && <>
                  <span style={{ color: "var(--text)", flexShrink: 0, fontWeight: 700 }}>{idx + 1}.</span>
                  <span style={{ fontWeight: 400 }}>{leftItem.texto}</span>
                </>}
              </div>

              {/* Col 2 — select */}
              <div>
                {leftItem && (
                  <select disabled={disabled} className="select"
                    style={{ fontSize: 11, padding: "2px 4px", width: 80 }}
                    value={mapeo[leftItem.id] || ""}
                    onChange={(e) => handleSelect(leftItem.id, e.target.value)}>
                    <option value="">—</option>
                    {der.map((d, di) => (
                      <option key={d.id} value={d.id}>
                        {String.fromCharCode(65 + di)}. {d.texto}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Col 3 — vacía */}
              <div />

              {/* Col 4 — texto der */}
              <div style={{ fontSize: 14, color: "var(--text)", display: "flex", alignItems: "flex-start", gap: 4, marginLeft: -20 }}>
                {rightItem && <>
                  <span style={{ flexShrink: 0, fontWeight: 700 }}>{String.fromCharCode(65 + idx)}.</span>
                  <span style={{ fontWeight: 400 }}>{rightItem.texto}</span>
                </>}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const profile = (me?.profile ?? {}) as Record<string, unknown>;
  const course  = (me?.course  ?? {}) as Record<string, unknown>;

  const timerColor =
    secondsLeft <= 60  ? "#dc2626" :
    secondsLeft <= 300 ? "#ea580c" : "#16a34a";

  const preguntasVisible =
    phase === "active" || phase === "timeout_modal" || phase === "submitting";

  return (
    <>
      {/* Overlay scrollable */}
      <div style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.88)", zIndex: 200, overflowY: "auto",
      }}>
        <div style={{ maxWidth: 780, margin: "28px auto 60px", padding: "0 16px", boxSizing: "border-box" }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>

            {/* Encabezado sticky */}
            <div style={{
              position: "sticky", top: 0, zIndex: 10,
              background: "color-mix(in srgb, var(--card) 60%, transparent)",
              backdropFilter: "blur(8px)",
              borderBottom: "1px solid var(--stroke)",
              padding: "16px 24px",
            }}>
              {/* T28 — fila 1: Año / Nivel / Curso */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 6 }}>
                <span><span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Año: </span><span style={{ fontSize: 13, color: "var(--muted)" }}>{course.year ?? "—"}</span></span>
                <span><span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Nivel: </span><span style={{ fontSize: 13, color: "var(--muted)" }}>{course.level ?? "—"}</span></span>
                <span><span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Curso: </span><span style={{ fontSize: 13, color: "var(--muted)" }}>{course.name ?? "—"}</span></span>
              </div>
              {/* T28 — fila 2: Módulo / Materia */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 6 }}>
                {examInfo.module_name && (
                  <span><span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Módulo: </span><span style={{ fontSize: 13, color: "var(--muted)" }}>{examInfo.module_name}</span></span>
                )}
                <span><span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Materia: </span><span style={{ fontSize: 13, color: "var(--muted)" }}>{examInfo.class_name ?? "—"}</span></span>
              </div>
              {/* T28 — fila 3: Cédula / Nombre */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 24 }}>
                <span><span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Cédula: </span><span style={{ fontSize: 13, color: "var(--muted)" }}>{profile.cedula ?? "—"}</span></span>
                <span><span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Nombre: </span><span style={{ fontSize: 13, color: "var(--muted)" }}>{profile.name ?? "—"}</span></span>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, position: "relative" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{examInfo.title}</h2>
                  {examInfo.tiempo_minutos && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {examInfo.tiempo_minutos} min · {preguntas.length} preguntas
                    </span>
                  )}
                </div>

                {/* Cronómetro centrado */}
                {phase !== "done" && (
                  <div style={{
                    position: "absolute", left: "50%", transform: "translateX(-50%)",
                    fontFamily: "monospace", fontSize: 30, fontWeight: 700,
                    color: phase === "active" ? timerColor : "var(--muted)",
                    pointerEvents: "none",
                  }}>
                    {formatTime(secondsLeft)}
                  </div>
                )}

                {/* T29/T30 — Botón */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {phase === "done" && calificacionFinal !== null && (
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 16, color: "var(--muted)", position: "relative", top: -2, right: 5 }}>Calificación: </span>
                      <span style={{
                        fontFamily: "monospace", fontSize: 30, fontWeight: 700,
                        color: calificacionFinal >= 70 ? "#16a34a" : "#dc2626",
                      }}>
                        {calificacionFinal.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div style={{ width: 0 }} />

                  {(phase === "ready") && (
                    <button className="btn" style={{ padding: "10px 22px" }} onClick={handleIniciar}>
                      Iniciar
                    </button>
                  )}
                  {phase === "starting" && (
                    <button className="btn" disabled style={{ padding: "10px 22px" }}>Iniciando...</button>
                  )}
                  {phase === "active" && (
                    <button className="btn"
                      style={{ padding: "10px 22px", background: "#dc2626", color: "#fff" }}
                      onClick={handleSubmit}>
                      Terminar
                    </button>
                  )}
                  {phase === "submitting" && (
                    <button className="btn" disabled style={{ padding: "10px 22px" }}>Enviando...</button>
                  )}
                </div>
              </div>

              {retomando && phase === "active" && (
                <div style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, background: "rgba(234,179,8,.15)", border: "1px solid rgba(234,179,8,.4)", fontSize: 13, color: "#a16207" }}>
                  Retomando examen — pregunta {currentIdx + 1} de {preguntas.length} · las preguntas anteriores ya fueron guardadas
                </div>
              )}
              {errMsg && <div className="msgError" style={{ marginTop: 10 }}>{errMsg}</div>}
            </div>

            {/* Cuerpo */}
            <div style={{ padding: "20px 24px 32px" }}>

              {phase === "loading" && (
                <p style={{ color: "var(--muted)", textAlign: "center" }}>Cargando examen...</p>
              )}

              {phase === "ya_rendido" && (
                <div style={{ textAlign: "center", padding: "48px 0" }}>
                  <p style={{ fontSize: 15, color: "var(--muted)", marginBottom: 24 }}>
                    Ya has rendido este examen.
                  </p>
                  <button className="btn" style={{ padding: "10px 28px" }} onClick={onClose}>
                    ← Regresar
                  </button>
                </div>
              )}

              {phase === "done" && (() => {
                const flv  = examInfo.fecha_limite_ver;
                const ffin = examInfo.fecha_fin;
                const now  = new Date();
                const fmtDate = (iso: string) => {
                  const MESES = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
                  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/Bogota" }));
                  const hh = d.getHours(), mm = d.getMinutes();
                  return `${String(d.getDate()).padStart(2,"0")}-${MESES[d.getMonth()]}-${d.getFullYear()} ${String(hh % 12 || 12).padStart(2,"0")}:${String(mm).padStart(2,"0")}${hh < 12 ? "am" : "pm"}`;
                };

                let msg: React.ReactNode;
                if (!flv) {
                  msg = <>Tu examen fue enviado correctamente. El profesor publicará los resultados próximamente.</>;
                } else if (now > new Date(flv)) {
                  msg = <>Tu examen fue enviado. El período de revisión ha cerrado.</>;
                } else {
                  // now ≤ fecha_fin (estudiante terminó antes de que cerrara el período)
                  const abrirEn = ffin ? fmtDate(ffin) : null;
                  const cerrarEn = fmtDate(flv);
                  msg = <>
                    Tu examen fue enviado correctamente. Podrás revisar tus resultados
                    {abrirEn && <> a partir del <strong style={{ color: "var(--text)" }}>{abrirEn}</strong></>}
                    {" "}hasta el <strong style={{ color: "var(--text)" }}>{cerrarEn}</strong>.
                  </>;
                }

                return (
                  <div style={{ textAlign: "center", padding: "48px 24px" }}>
                    <div style={{ fontSize: 44, marginBottom: 14 }}>✅</div>
                    <h3 style={{ margin: "0 0 10px" }}>Examen enviado</h3>
                    <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>{msg}</p>
                    <button className="btn"
                      style={{ background: "linear-gradient(180deg,#9ca3af,#6b7280)", color: "#fff", padding: "10px 28px" }}
                      onClick={() => onClose(true)}>
                      ← Regresar
                    </button>
                  </div>
                );
              })()}

              {/* T29 — antes de iniciar: preguntas ocultas */}
              {(phase === "ready" || phase === "starting") && (
                <div style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)" }}>
                  <p style={{ fontSize: 16, marginBottom: 8 }}>
                    Haz clic en <strong style={{ color: "var(--text)" }}>Iniciar</strong> para comenzar.
                  </p>
                  <p style={{ fontSize: 13 }}>
                    El tiempo inicia en cuanto presiones el botón.
                  </p>
                </div>
              )}

              {/* Pregunta actual */}
              {preguntasVisible && preguntas.length > 0 && (() => {
                const p   = preguntas[currentIdx];
                const idx = currentIdx;
                return (
                  <div key={p.id} className="card"
                    style={{ marginBottom: 14, borderLeft: "3px solid var(--stroke)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>
                        Pregunta {idx + 1}
                        <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                          de {preguntas.length}
                        </span>
                        {p.tipo === "multiple_single" && (
                          <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12, marginLeft: 12 }}>· Selecciona una respuesta</span>
                        )}
                        {p.tipo === "multiple_multi" && (
                          <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12, marginLeft: 12 }}>· Selecciona todas las correctas</span>
                        )}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.puntos} pt{p.puntos !== 1 ? "s" : ""}</span>
                    </div>
                    <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.55 }}>{p.enunciado}</p>

                    {(p.tipo === "multiple_single" || p.tipo === "multiple_multi") &&
                      renderMultiple(p, p.tipo === "multiple_multi")}
                    {p.tipo === "falso_verdadero" && renderFV(p)}
                    {p.tipo === "emparejamiento"  && renderEmparejamiento(p)}

                    {warnNoResp && (
                      <div className="msgError" style={{ marginTop: 14 }}>
                        Debes seleccionar una respuesta antes de continuar.
                      </div>
                    )}
                  </div>
                );
              })()}

              {preguntasVisible && currentIdx < preguntas.length - 1 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button className="btn"
                    style={{ padding: "8px 18px", fontSize: 14, background: "linear-gradient(180deg,#9ca3af,#6b7280)", boxShadow: "0 4px 14px rgba(107,114,128,.35)", opacity: savingAnswer ? 0.6 : 1 }}
                    disabled={savingAnswer}
                    onClick={handleSiguiente}>
                    {savingAnswer ? "Guardando..." : "Siguiente Pregunta >>"}
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* T32 — Modal: Se terminó el tiempo */}
      {phase === "timeout_modal" && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 400,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="card" style={{ maxWidth: 360, width: "90%", padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>⏰</div>
            <h3 style={{ margin: "0 0 10px" }}>Se terminó el tiempo</h3>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
              Tu examen será enviado con las respuestas registradas.
            </p>
            <button className="btn" style={{ padding: "10px 32px" }} onClick={handleSubmit}>
              Aceptar
            </button>
          </div>
        </div>
      )}

    </>
  );
}
