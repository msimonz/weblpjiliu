"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoPregunta = "multiple_multi" | "multiple_single" | "falso_verdadero" | "emparejamiento";
type OpcionSimple  = { id: string; texto: string };

type PreguntaState = {
  _key:          string;
  tipo:          TipoPregunta | "";
  enunciado:     string;
  puntos:        string;
  // multiple_single / multiple_multi
  opciones:      OpcionSimple[];
  respuestaMulti: string[];
  // falso_verdadero
  respuestaFV:   "V" | "F" | "";
  // emparejamiento
  izquierda:     OpcionSimple[];
  derecha:       OpcionSimple[];
  mapeo:         Record<string, string>; // leftId → rightId
};

export type CrearExamenCtx = {
  id_course:   number;
  id_class:    number;
  id_module:   number | null;
  id_group:    number | null;
  title:       string;
  percent:     number;
  courseName:  string;
  className:   string;
  moduleName:  string | null;
  levelName:   string | null;
};

type ApiPregunta = {
  id: number;
  orden: number;
  tipo: TipoPregunta;
  enunciado: string;
  puntos: number;
  opciones: { izquierda?: unknown[]; derecha?: unknown[] } | unknown[] | null | undefined;
  respuesta_correcta: unknown;
};

export type ExamInitialData = {
  id: number;
  tiempo_minutos: number;
  preguntas: ApiPregunta[];
};

interface Props {
  ctx:           CrearExamenCtx;
  examId?:       number;
  initialData?:  ExamInitialData;
  onSaved:       () => void;
  onCancel:      () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

function newPregunta(): PreguntaState {
  return {
    _key:          uid(),
    tipo:          "",
    enunciado:     "",
    puntos:        "",
    opciones:      [{ id: uid(), texto: "" }, { id: uid(), texto: "" }],
    respuestaMulti: [],
    respuestaFV:   "",
    izquierda:     [{ id: uid(), texto: "" }, { id: uid(), texto: "" }],
    derecha:       [{ id: uid(), texto: "" }, { id: uid(), texto: "" }],
    mapeo:         {},
  };
}

const TIPO_LABELS: Record<TipoPregunta, string> = {
  multiple_single: "Selección múltiple — única respuesta",
  multiple_multi:  "Selección múltiple — varias respuestas",
  falso_verdadero: "Falso o Verdadero",
  emparejamiento:  "Emparejamiento",
};

function apiToState(p: ApiPregunta): PreguntaState {
  const base: PreguntaState = {
    _key: uid(), tipo: p.tipo, enunciado: p.enunciado, puntos: String(p.puntos),
    opciones: [], respuestaMulti: [], respuestaFV: "", izquierda: [], derecha: [], mapeo: {},
  };
  if (p.tipo === "multiple_single" || p.tipo === "multiple_multi") {
    return { ...base, opciones: Array.isArray(p.opciones) ? p.opciones as OpcionSimple[] : [], respuestaMulti: Array.isArray(p.respuesta_correcta) ? p.respuesta_correcta as string[] : [] };
  }
  if (p.tipo === "falso_verdadero") {
    return { ...base, opciones: [{ id: "V", texto: "Verdadero" }, { id: "F", texto: "Falso" }], respuestaFV: Array.isArray(p.respuesta_correcta) ? (p.respuesta_correcta[0] as "V" | "F") : "" };
  }
  if (p.tipo === "emparejamiento") {
    const opc = p.opciones as { izquierda?: unknown[]; derecha?: unknown[] } | null | undefined;
    return { ...base, izquierda: Array.isArray(opc?.izquierda) ? opc!.izquierda as string[] : [], derecha: Array.isArray(opc?.derecha) ? opc!.derecha as string[] : [], mapeo: (typeof p.respuesta_correcta === "object" && !Array.isArray(p.respuesta_correcta)) ? p.respuesta_correcta as Record<string, string> : {} };
  }
  return base;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CrearExamen({ ctx, examId, initialData, onSaved, onCancel }: Props) {
  const [percent, setPercent]             = useState<string>(() => String(ctx.percent));
  const [tiempoMinutos, setTiempoMinutos] = useState<string>(() => initialData ? String(initialData.tiempo_minutos) : "");
  const [preguntas, setPreguntas]         = useState<PreguntaState[]>(() =>
    initialData?.preguntas?.length
      ? initialData.preguntas.map(apiToState)
      : [newPregunta(), newPregunta(), newPregunta(), newPregunta()]
  );
  const [saving, setSaving]               = useState(false);
  const [errMsg, setErrMsg]               = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const sumaActual = preguntas.reduce((s, p) => s + (Number(p.puntos) || 0), 0);
  const sumaOk     = Math.abs(sumaActual - 100) < 0.01;

  // ── State updaters ─────────────────────────────────────────────────────────

  function upd(key: string, patch: Partial<PreguntaState>) {
    setPreguntas(prev => prev.map(p => p._key === key ? { ...p, ...patch } : p));
  }
  function addPregunta() {
    if (preguntas.length >= 20) return;
    setPreguntas(prev => [...prev, newPregunta()]);
  }
  function removePregunta(key: string) {
    setPreguntas(prev => prev.filter(p => p._key !== key));
  }

  // opciones (multiple)
  function addOpcion(key: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p :
      { ...p, opciones: [...p.opciones, { id: uid(), texto: "" }] }));
  }
  function removeOpcion(key: string, opId: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p : {
      ...p,
      opciones:      p.opciones.filter(o => o.id !== opId),
      respuestaMulti: p.respuestaMulti.filter(id => id !== opId),
    }));
  }
  function updOpcion(key: string, opId: string, texto: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p :
      { ...p, opciones: p.opciones.map(o => o.id === opId ? { ...o, texto } : o) }));
  }

  // emparejamiento — izquierda
  function addIzq(key: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p :
      { ...p, izquierda: [...p.izquierda, { id: uid(), texto: "" }] }));
  }
  function removeIzq(key: string, opId: string) {
    setPreguntas(prev => prev.map(p => {
      if (p._key !== key) return p;
      const mapeo = { ...p.mapeo }; delete mapeo[opId];
      return { ...p, izquierda: p.izquierda.filter(o => o.id !== opId), mapeo };
    }));
  }
  function updIzq(key: string, opId: string, texto: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p :
      { ...p, izquierda: p.izquierda.map(o => o.id === opId ? { ...o, texto } : o) }));
  }

  // emparejamiento — derecha
  function addDer(key: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p :
      { ...p, derecha: [...p.derecha, { id: uid(), texto: "" }] }));
  }
  function removeDer(key: string, opId: string) {
    setPreguntas(prev => prev.map(p => {
      if (p._key !== key) return p;
      const mapeo: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.mapeo)) { if (v !== opId) mapeo[k] = v; }
      return { ...p, derecha: p.derecha.filter(o => o.id !== opId), mapeo };
    }));
  }
  function updDer(key: string, opId: string, texto: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p :
      { ...p, derecha: p.derecha.map(o => o.id === opId ? { ...o, texto } : o) }));
  }
  function _setMapeo(key: string, leftId: string, rightId: string) {
    setPreguntas(prev => prev.map(p => p._key !== key ? p :
      { ...p, mapeo: { ...p.mapeo, [leftId]: rightId } }));
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function validate(): string | null {
    const pct = Number(percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return "Porcentaje inválido (1..100)";
    const mins = Number(tiempoMinutos);
    if (!mins || mins < 1) return "Tiempo en minutos requerido (mínimo 1)";
    if (preguntas.length < 1)  return "El examen debe tener al menos 1 pregunta";
    if (preguntas.length > 20) return "Máximo 20 preguntas";
    let suma = 0;
    for (let i = 0; i < preguntas.length; i++) {
      const p = preguntas[i]; const n = i + 1;
      if (!p.tipo) return `Pregunta ${n}: selecciona un tipo`;
      if (!p.enunciado.trim()) return `Pregunta ${n}: enunciado requerido`;
      const pts = Number(p.puntos);
      if (!pts || pts <= 0) return `Pregunta ${n}: puntos inválidos`;
      suma += pts;
      if (p.tipo === "multiple_single" || p.tipo === "multiple_multi") {
        if (p.opciones.length < 2) return `Pregunta ${n}: mínimo 2 opciones`;
        if (p.opciones.some(o => !o.texto.trim())) return `Pregunta ${n}: todas las opciones necesitan texto`;
        if (p.respuestaMulti.length === 0) return `Pregunta ${n}: selecciona al menos una respuesta correcta`;
        if (p.tipo === "multiple_single" && p.respuestaMulti.length > 1)
          return `Pregunta ${n}: solo se permite una respuesta correcta`;
      }
      if (p.tipo === "falso_verdadero") {
        if (!p.respuestaFV) return `Pregunta ${n}: selecciona Verdadero o Falso`;
      }
      if (p.tipo === "emparejamiento") {
        if (p.izquierda.length < 2) return `Pregunta ${n}: mínimo 2 elementos en columna izquierda`;
        if (p.derecha.length < 2)   return `Pregunta ${n}: mínimo 2 elementos en columna derecha`;
        if (p.izquierda.some(o => !o.texto.trim())) return `Pregunta ${n}: todos los elementos izquierda necesitan texto`;
        if (p.derecha.some(o => !o.texto.trim()))   return `Pregunta ${n}: todos los elementos derecha necesitan texto`;
      }
    }
    if (Math.abs(suma - 100) > 0.01)
      return `La suma de puntos debe ser 100 (actual: ${suma % 1 === 0 ? suma : suma.toFixed(2)})`;
    return null;
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setErrMsg(null);
    const err = validate();
    if (err) { setErrMsg(err); return; }
    setSaving(true);
    try {
      const payload = preguntas.map(p => {
        if (p.tipo === "falso_verdadero") return {
          tipo: p.tipo, enunciado: p.enunciado.trim(), puntos: Number(p.puntos),
          opciones: [{ id: "V", texto: "Verdadero" }, { id: "F", texto: "Falso" }],
          respuesta_correcta: [p.respuestaFV],
        };
        if (p.tipo === "emparejamiento") {
          const mapeo: Record<string, string> = {};
          const pairs = Math.min(p.izquierda.length, p.derecha.length);
          for (let i = 0; i < pairs; i++) mapeo[p.izquierda[i].id] = p.derecha[i].id;
          return {
            tipo: p.tipo, enunciado: p.enunciado.trim(), puntos: Number(p.puntos),
            opciones: { izquierda: p.izquierda, derecha: p.derecha },
            respuesta_correcta: mapeo,
          };
        }
        return {
          tipo: p.tipo, enunciado: p.enunciado.trim(), puntos: Number(p.puntos),
          opciones: p.opciones,
          respuesta_correcta: p.respuestaMulti,
        };
      });
      await apiFetch(examId ? `/api/admin/exams/${examId}` : "/api/admin/exams", {
        method: examId ? "PUT" : "POST",
        body: JSON.stringify(examId ? {
          percent:        Number(percent),
          tiempo_minutos: Number(tiempoMinutos),
          preguntas:      payload,
        } : {
          id_course:      ctx.id_course,
          id_class:       ctx.id_class,
          title:          ctx.title,
          percent:        Number(percent),
          tiempo_minutos: Number(tiempoMinutos),
          preguntas:      payload,
        }),
      });
      onSaved();
    } catch (e) {
      setErrMsg((e as { message?: string })?.message || "Error guardando examen");
    } finally {
      setSaving(false);
    }
  }

  // ── Per-type form renderers ─────────────────────────────────────────────────

  function renderMultiple(p: PreguntaState, isMulti: boolean) {
    return (
      <div>
        <div className="label" style={{ marginBottom: 6, fontWeight: 400 }}>
          Opciones&nbsp;
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>
            {isMulti ? "(marca todas las correctas)" : "(marca la única correcta)"}
          </span>
        </div>
        {p.opciones.map((op, oi) => (
          <div key={op.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            {isMulti ? (
              <input type="checkbox"
                checked={p.respuestaMulti.includes(op.id)}
                onChange={e => {
                  const sel = e.target.checked
                    ? [...p.respuestaMulti, op.id]
                    : p.respuestaMulti.filter(id => id !== op.id);
                  upd(p._key, { respuestaMulti: sel });
                }}
                style={{ accentColor: "#16a34a", width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
              />
            ) : (
              <input type="radio" name={`radio_${p._key}`}
                checked={p.respuestaMulti[0] === op.id}
                onChange={() => upd(p._key, { respuestaMulti: [op.id] })}
                style={{ accentColor: "#16a34a", width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
              />
            )}
            <input className="input" style={{ flex: 1, fontWeight: 400 }}
              placeholder={`Opción ${oi + 1}`}
              value={op.texto}
              onChange={e => updOpcion(p._key, op.id, e.target.value)}
            />
            {p.opciones.length > 2 && (
              <button style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 20, lineHeight: 1, padding: 0 }}
                onClick={() => removeOpcion(p._key, op.id)}>×</button>
            )}
          </div>
        ))}
        <button
          style={{ fontSize: 12, background: "none", border: "1px dashed var(--stroke)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", color: "var(--muted)" }}
          onClick={() => addOpcion(p._key)}>
          + Agregar opción
        </button>
      </div>
    );
  }

  function renderFV(p: PreguntaState) {
    return (
      <div>
        <div className="label" style={{ marginBottom: 8, fontWeight: 400 }}>Respuesta correcta</div>
        <div style={{ display: "flex", gap: 24 }}>
          {(["V", "F"] as const).map(val => (
            <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
              <input type="radio" name={`fv_${p._key}`}
                checked={p.respuestaFV === val}
                onChange={() => upd(p._key, { respuestaFV: val })}
                style={{ accentColor: "#16a34a", width: 16, height: 16 }}
              />
              {val === "V" ? "Verdadero" : "Falso"}
            </label>
          ))}
        </div>
      </div>
    );
  }

  function renderEmparejamiento(p: PreguntaState) {
    const maxRows = Math.max(p.izquierda.length, p.derecha.length);
    return (
      <div>
        {/* Encabezados */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
          <div className="label" style={{ fontWeight: 400 }}>
            Columna izquierda
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>({p.izquierda.length})</span>
          </div>
          <div className="label" style={{ fontWeight: 400 }}>
            Columna derecha
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>({p.derecha.length})</span>
          </div>
        </div>

        {/* Filas: izq input | der input */}
        {Array.from({ length: maxRows }).map((_, idx) => {
          const leftItem  = p.izquierda[idx];
          const rightItem = p.derecha[idx];
          const isPaired  = !!leftItem && !!rightItem;
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6, alignItems: "center" }}>
              {/* Celda izquierda */}
              {leftItem ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ minWidth: 20, fontSize: 13, color: isPaired ? "var(--text)" : "#ea580c", flexShrink: 0, fontWeight: 700 }}>{idx + 1}.</span>
                  <input className="input" style={{ flex: 1, fontWeight: 400 }}
                    placeholder={`Elemento ${idx + 1}`}
                    value={leftItem.texto}
                    onChange={e => updIzq(p._key, leftItem.id, e.target.value)}
                  />
                  {p.izquierda.length > 2 && (
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0 }}
                      onClick={() => removeIzq(p._key, leftItem.id)}>×</button>
                  )}
                </div>
              ) : <div />}

              {/* Celda derecha */}
              {rightItem ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ minWidth: 20, fontSize: 13, color: isPaired ? "var(--text)" : "#ea580c", flexShrink: 0, fontWeight: 700 }}>{String.fromCharCode(65 + idx)}.</span>
                  <input className="input" style={{ flex: 1, fontWeight: 400 }}
                    placeholder={`Elemento ${String.fromCharCode(65 + idx)}`}
                    value={rightItem.texto}
                    onChange={e => updDer(p._key, rightItem.id, e.target.value)}
                  />
                  {p.derecha.length > 2 && (
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0 }}
                      onClick={() => removeDer(p._key, rightItem.id)}>×</button>
                  )}
                </div>
              ) : <div />}
            </div>
          );
        })}

        {/* Botones agregar */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
          <button style={{ fontSize: 12, background: "none", border: "1px dashed var(--stroke)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", color: "var(--muted)" }}
            onClick={() => addIzq(p._key)}>+ Izquierda</button>
          <button style={{ fontSize: 12, background: "none", border: "1px dashed var(--stroke)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", color: "var(--muted)" }}
            onClick={() => addDer(p._key)}>+ Derecha</button>
        </div>
        {p.izquierda.length !== p.derecha.length && (
          <div style={{ fontSize: 11, color: "#ea580c", marginTop: 6 }}>
            Los ítems sin pareja ({Math.abs(p.izquierda.length - p.derecha.length)}) serán respuestas trampa.
          </div>
        )}
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay — scroll container, atenúa el panel Admin */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 200, overflowY: "auto" }}>
        <div style={{ maxWidth: 860, margin: "28px auto 60px", padding: "0 24px", boxSizing: "border-box" }}>

          {/* ── Único contenedor general ── */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>

            {/* Encabezado sticky dentro del card */}
            <div style={{
              position: "sticky", top: 0, zIndex: 10,
              background: "color-mix(in srgb, var(--card) 50%, transparent)",
              backdropFilter: "blur(8px)",
              borderBottom: "1px solid var(--stroke)",
              padding: "20px 24px 16px",
            }}>
              <h2 style={{ marginTop: 0, marginBottom: 16 }}>{examId ? "Editar Examen" : "Crear Examen"}</h2>

              {/* Context info + tiempo */}
              <div className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "6px 24px", fontSize: 13, marginBottom: 12 }}>
                  <div><span style={{ color: "var(--muted)" }}>Título: </span><strong>{ctx.title}</strong></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--muted)" }}>Porcentaje:</span>
                    <input type="number" min={1} max={100} className="input"
                      style={{ width: 64, textAlign: "center", padding: "2px 6px", fontSize: 13 }}
                      value={percent}
                      onChange={e => setPercent(e.target.value)}
                    />
                    <span style={{ fontSize: 13 }}>%</span>
                  </div>
                  {ctx.levelName  && <div><span style={{ color: "var(--muted)" }}>Año: </span><strong>{ctx.levelName}</strong></div>}
                  <div><span style={{ color: "var(--muted)" }}>Curso: </span><strong>{ctx.courseName}</strong></div>
                  {ctx.moduleName && <div><span style={{ color: "var(--muted)" }}>Módulo: </span><strong>{ctx.moduleName}</strong></div>}
                  <div><span style={{ color: "var(--muted)" }}>Materia: </span><strong>{ctx.className}</strong></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="label" style={{ margin: 0, whiteSpace: "nowrap" }}>Tiempo (minutos)</div>
                  <input type="number" min={1} max={300} className="input"
                    style={{ width: 100, textAlign: "center" }}
                    value={tiempoMinutos}
                    onChange={e => setTiempoMinutos(e.target.value)}
                    placeholder="ej: 60"
                  />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Tiempo disponible para contestar</span>
                </div>
              </div>

              {/* Error */}
              {errMsg && <div className="msgError" style={{ marginBottom: 10 }}>{errMsg}</div>}

              {/* Puntos counter + botones */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13 }}>Suma de puntos:</span>
                <span style={{
                  fontWeight: 700, fontSize: 15, padding: "2px 12px", borderRadius: 8,
                  background: sumaOk ? "#dcfce7" : sumaActual > 100 ? "#fee2e2" : "var(--card)",
                  color:      sumaOk ? "#15803d" : sumaActual > 100 ? "#dc2626" : "var(--text)",
                  border:     `1px solid ${sumaOk ? "#bbf7d0" : sumaActual > 100 ? "#fecaca" : "var(--stroke)"}`,
                }}>
                  {sumaActual % 1 === 0 ? sumaActual : sumaActual.toFixed(2)} / 100
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {preguntas.length} pregunta{preguntas.length !== 1 ? "s" : ""} · mín 4, máx 20
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                  <button className="btn"
                    style={{ background: "var(--card)", color: "var(--text)", border: "1px solid var(--stroke)", padding: "8px 18px" }}
                    onClick={() => setConfirmCancel(true)}
                    disabled={saving}>
                    Cancelar
                  </button>
                  <button className="btn" style={{ padding: "8px 18px" }} onClick={handleSave} disabled={saving}>
                    {saving ? "Guardando..." : "Guardar Examen"}
                  </button>
                </div>
              </div>
            </div>{/* fin encabezado sticky */}

            {/* Cuerpo — preguntas (scrollea junto con la página) */}
            <div style={{ padding: "20px 24px 28px" }}>

          {/* Preguntas */}
          {preguntas.map((p, idx) => (
            <div key={p._key} className="card"
              style={{ marginBottom: 14, borderLeft: "3px solid var(--stroke)" }}>

              {/* Cabecera pregunta */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Pregunta {idx + 1}</span>
                {preguntas.length > 4 && (
                  <button style={{ fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer" }}
                    onClick={() => removePregunta(p._key)}>
                    Eliminar
                  </button>
                )}
              </div>

              {/* Tipo + Puntos */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 12, marginBottom: 12, alignItems: "end" }}>
                <div>
                  <div className="label" style={{ fontWeight: 400 }}>Tipo</div>
                  <select className="select" style={{ fontWeight: 400 }} value={p.tipo}
                    onChange={e => upd(p._key, {
                      tipo: e.target.value as TipoPregunta | "",
                      respuestaMulti: [], respuestaFV: "", mapeo: {},
                    })}>
                    <option value="">Seleccionar tipo...</option>
                    {(Object.entries(TIPO_LABELS) as [TipoPregunta, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="label" style={{ fontWeight: 400 }}>Puntos</div>
                  <input type="number" min={0.5} max={100} step={0.5} className="input"
                    style={{ textAlign: "center", fontWeight: 400 }}
                    value={p.puntos}
                    onChange={e => upd(p._key, { puntos: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Enunciado */}
              {p.tipo && (
                <div style={{ marginBottom: 12 }}>
                  <div className="label" style={{ fontWeight: 400 }}>Enunciado</div>
                  <textarea className="input"
                    style={{ width: "100%", boxSizing: "border-box", minHeight: 56, resize: "vertical", fontFamily: "inherit", fontSize: 14, fontWeight: 400 }}
                    value={p.enunciado}
                    onChange={e => upd(p._key, { enunciado: e.target.value })}
                    placeholder="Escribe la pregunta..."
                  />
                </div>
              )}

              {/* Formulario dinámico según tipo */}
              {(p.tipo === "multiple_single" || p.tipo === "multiple_multi") && renderMultiple(p, p.tipo === "multiple_multi")}
              {p.tipo === "falso_verdadero"  && renderFV(p)}
              {p.tipo === "emparejamiento"   && renderEmparejamiento(p)}
            </div>
          ))}

          {/* Agregar pregunta */}
          {preguntas.length < 20 && (
            <button className="btn"
              style={{ width: "100%", marginBottom: 24, background: "none", border: "1px dashed var(--stroke)", color: "var(--text)" }}
              onClick={addPregunta}>
              + Agregar Pregunta ({preguntas.length} / 20)
            </button>
          )}

            </div>{/* fin cuerpo */}
          </div>{/* fin card general */}
        </div>
      </div>

      {/* Modal confirmar cancelar */}
      {confirmCancel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ maxWidth: 380, width: "90%", padding: 24 }}>
            <p style={{ marginTop: 0, marginBottom: 20 }}>
              ¿Cancelar la creación del examen? Se perderán todos los cambios.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button className="btn"
                style={{ background: "var(--card)", color: "var(--text)", border: "1px solid var(--stroke)" }}
                onClick={() => setConfirmCancel(false)}>
                Continuar editando
              </button>
              <button className="btn" style={{ background: "#dc2626", color: "white" }}
                onClick={onCancel}>
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
