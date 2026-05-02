"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ExamAvailableItem } from "./TomarExamen";
import { seededShuffle } from "@/lib/shuffleUtils";

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoPregunta = "multiple_multi" | "multiple_single" | "falso_verdadero" | "emparejamiento";

type OpcionItem = { id: string; texto: string };
type RespuestaEstudiante = string[] | Record<string, string> | null;

type PreguntaResult = {
  id: number;
  orden: number;
  tipo: TipoPregunta;
  enunciado: string;
  puntos: number;
  opciones: OpcionItem[] | { izquierda: OpcionItem[]; derecha: OpcionItem[] } | null;
  respuesta_correcta: string[] | Record<string, string> | null;
};

type ExamResult = {
  id_evaluation: number;
  calificacion: number;
  iniciado_at: string;
  finalizado_at: string;
  respuestas: { id_pregunta: number; respuesta: RespuestaEstudiante }[];
  preguntas: PreguntaResult[];
};

interface Props {
  id_evaluation: number;
  examInfo: ExamAvailableItem;
  me: Record<string, unknown>;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStudentAnswer(result: ExamResult, pregId: number): RespuestaEstudiante {
  const entry = result.respuestas.find((r) => Number(r.id_pregunta) === pregId);
  return entry?.respuesta ?? null;
}

// Devuelve { correct: bool, earned: number } — emparejamiento usa puntos parciales
function scoreAnswer(p: PreguntaResult, studentAns: RespuestaEstudiante): { correct: boolean; earned: number } {
  const correct = p.respuesta_correcta;
  if (p.tipo === "multiple_multi") {
    const sa = Array.isArray(studentAns) ? [...studentAns].sort() : [];
    const ca = Array.isArray(correct)    ? [...correct].sort()    : [];
    const ok = JSON.stringify(sa) === JSON.stringify(ca);
    return { correct: ok, earned: ok ? Number(p.puntos) : 0 };
  }
  if (p.tipo === "multiple_single" || p.tipo === "falso_verdadero") {
    const sa = Array.isArray(studentAns) ? studentAns[0] : studentAns;
    const ca = Array.isArray(correct)    ? correct[0]    : correct;
    const ok = String(sa ?? "") === String(ca ?? "");
    return { correct: ok, earned: ok ? Number(p.puntos) : 0 };
  }
  if (p.tipo === "emparejamiento") {
    const recCorrect = (correct && !Array.isArray(correct)) ? correct as Record<string, string> : {};
    const keys = Object.keys(recCorrect);
    if (keys.length === 0) return { correct: false, earned: 0 };
    if (!studentAns || Array.isArray(studentAns)) return { correct: false, earned: 0 };
    const recStudent = studentAns as Record<string, string>;
    const aciertos = keys.filter((k) => String(recStudent[k] ?? "") === String(recCorrect[k] ?? "")).length;
    const earned = Number(((Number(p.puntos) * aciertos) / keys.length).toFixed(2));
    return { correct: aciertos === keys.length, earned };
  }
  return { correct: false, earned: 0 };
}

const GREEN_BD = "#16a34a";
const RED_BD   = "#dc2626";
const SEL_BG   = "color-mix(in srgb, var(--stroke) 90%, transparent)";

// ─── Component ────────────────────────────────────────────────────────────────

export default function VerExamen({ id_evaluation, examInfo, me, onClose }: Props) {
  const [result,  setResult]  = useState<ExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg,  setErrMsg]  = useState<string | null>(null);

  // T34 — GET /result al montar
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<ExamResult>(`/api/student/exam/${id_evaluation}/result`);
        setResult(data);
      } catch (e) {
        setErrMsg((e as { message?: string })?.message || "Error cargando resultado");
      } finally {
        setLoading(false);
      }
    })();
  }, [id_evaluation]);

  const profile = (me?.profile ?? {}) as Record<string, string | number | null | undefined>;
  const course  = (me?.course  ?? {}) as Record<string, string | number | null | undefined>;

  // ── Renderers ────────────────────────────────────────────────────────────────

  function renderMultiple(p: PreguntaResult, studentAns: RespuestaEstudiante, isMulti: boolean) {
    const opts: OpcionItem[] = Array.isArray(p.opciones) ? p.opciones as OpcionItem[] : [];
    const correct: string[] = Array.isArray(p.respuesta_correcta) ? p.respuesta_correcta : [];
    const selected: string[] = Array.isArray(studentAns) ? studentAns : [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {opts.map((op) => {
          const isSelected   = selected.includes(op.id);
          const isCorrectOpt = correct.includes(op.id);

          let icon: string | null = null;
          let iconColor = "transparent";
          let iconOpacity = 1;

          if (isCorrectOpt && isSelected)  { icon = "✓"; iconColor = GREEN_BD; }
          else if (isCorrectOpt)           { icon = "✓"; iconColor = GREEN_BD; iconOpacity = 0.35; }
          else if (isSelected)             { icon = "✗"; iconColor = RED_BD; }

          return (
            <label key={op.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              cursor: "default", fontSize: 14,
              padding: "4px 8px", borderRadius: 6,
              background: isSelected ? SEL_BG : "transparent",
            }}>
              {isMulti ? (
                <input type="checkbox" disabled checked={isSelected}
                  style={{ width: 16, height: 16, accentColor: "#16a34a", flexShrink: 0 }} />
              ) : (
                <input type="radio" disabled checked={isSelected}
                  name={`ver_preg_${p.id}`}
                  style={{ width: 16, height: 16, accentColor: "#16a34a", flexShrink: 0 }} />
              )}
              <span>{op.texto}</span>
              {icon && (
                <span style={{ color: iconColor, opacity: iconOpacity, fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
                  {icon}
                </span>
              )}
            </label>
          );
        })}
      </div>
    );
  }

  function renderFV(p: PreguntaResult, studentAns: RespuestaEstudiante) {
    const selected: string = Array.isArray(studentAns) ? String(studentAns[0] ?? "") : "";
    const correctVal: string = Array.isArray(p.respuesta_correcta) ? String(p.respuesta_correcta[0] ?? "") : "";
    return (
      <div style={{ display: "flex", gap: 32 }}>
        {(["V", "F"] as const).map((val) => {
          const label        = val === "V" ? "Verdadero" : "Falso";
          const isSelected   = selected === val;
          const isCorrectOpt = correctVal === val;

          let icon: string | null = null;
          let iconColor = "transparent";
          const iconOpacity = 1;

          if (isCorrectOpt && isSelected)  { icon = "✓"; iconColor = GREEN_BD; }
          else if (isSelected)             { icon = "✗"; iconColor = RED_BD; }

          return (
            <label key={val} style={{
              display: "flex", alignItems: "center", gap: 8,
              cursor: "default", fontSize: 14,
              padding: "4px 10px", borderRadius: 6,
              background: isSelected ? SEL_BG : "transparent",
            }}>
              <input type="radio" disabled checked={isSelected}
                name={`ver_preg_${p.id}`}
                style={{ width: 16, height: 16, accentColor: "#16a34a" }} />
              {label}
              {icon && (
                <span style={{ color: iconColor, opacity: iconOpacity, fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
                  {icon}
                </span>
              )}
            </label>
          );
        })}
      </div>
    );
  }

  function renderEmparejamiento(p: PreguntaResult, studentAns: RespuestaEstudiante) {
    const opc = p.opciones as { izquierda?: OpcionItem[]; derecha?: OpcionItem[] } | null;
    const izq: OpcionItem[] = opc?.izquierda ?? [];
    const der: OpcionItem[] = opc?.derecha   ?? [];
    const correct: Record<string, string> =
      p.respuesta_correcta && !Array.isArray(p.respuesta_correcta)
        ? p.respuesta_correcta : {};
    const student: Record<string, string> =
      studentAns && !Array.isArray(studentAns) ? studentAns : {};

    // Mismo orden que vio el estudiante en TomarExamen
    const meUser = me?.user as { id?: unknown } | undefined;
    const studentId = String(meUser?.id ?? "");
    const shuffledDer = seededShuffle(der, studentId, id_evaluation, p.id);

    const derLetra  = new Map(shuffledDer.map((d, i) => [d.id, String.fromCharCode(65 + i)]));
    const derTexto  = new Map(der.map((d) => [d.id, d.texto]));

    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Columna izquierda */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {izq.map((item, ii) => {
            const correctRightId  = correct[item.id];
            const studentRightId  = student[item.id];
            const pairOk          = correctRightId === studentRightId;
            const letraCorrecta   = correctRightId ? (derLetra.get(correctRightId) ?? "?") : "?";
            const _textoCorrecta  = correctRightId ? (derTexto.get(correctRightId) ?? "") : "";
            const letraElegida    = studentRightId ? (derLetra.get(studentRightId) ?? "?") : "—";
            const color           = pairOk ? GREEN_BD : RED_BD;
            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14, flexWrap: "wrap" }}>
                <span style={{ color: "var(--text)", fontWeight: 700, flexShrink: 0 }}>{ii + 1}.</span>
                <span style={{ color: "var(--text)", fontWeight: 700, flexShrink: 0 }}>{letraCorrecta}.</span>
                <span style={{ color: "var(--text)", fontWeight: 400 }}>{item.texto}</span>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>→</span>
                <span style={{ color: "var(--text)", fontWeight: 700, flexShrink: 0 }}>{letraElegida}.</span>
                <span style={{ color, fontWeight: 700, flexShrink: 0, fontSize: 18 }}>
                  {pairOk ? "✓" : "✗"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Columna derecha — mismo orden que vio el estudiante */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shuffledDer.map((d, di) => (
            <div key={d.id} style={{ fontSize: 14, color: "var(--text)" }}>
              <span style={{ fontWeight: 700 }}>{String.fromCharCode(65 + di)}.</span> {d.texto}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.88)", zIndex: 200, overflowY: "auto",
    }}>
      <div style={{ maxWidth: 780, margin: "28px auto 60px", padding: "0 16px", boxSizing: "border-box" }}>
        <div className="card" style={{ padding: 0 }}>

          {/* Encabezado sticky */}
          <div style={{
            position: "sticky", top: 0, zIndex: 10,
            background: "color-mix(in srgb, var(--card) 60%, transparent)",
            backdropFilter: "blur(8px)",
            borderBottom: "1px solid var(--stroke)",
            borderTopLeftRadius: "var(--radius2)",
            borderTopRightRadius: "var(--radius2)",
            overflow: "hidden",
            padding: "16px 24px",
          }}>
            {/* T34 — fila 1: Cédula / Nombre */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>
              <span>Cédula: <strong style={{ color: "var(--text)" }}>{profile.cedula ?? "—"}</strong></span>
              <span>Nombre: <strong style={{ color: "var(--text)" }}>{profile.name ?? "—"}</strong></span>
            </div>
            {/* T34 — fila 2: Año / Nivel / Curso */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>
              <span>Año: <strong style={{ color: "var(--text)" }}>{course.year ?? "—"}</strong></span>
              <span>Nivel: <strong style={{ color: "var(--text)" }}>{course.level ?? "—"}</strong></span>
              <span>Curso: <strong style={{ color: "var(--text)" }}>{course.name ?? "—"}</strong></span>
            </div>
            {/* T34 — fila 3: Módulo / Materia / Calificación */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              {examInfo.module_name && (
                <span>Módulo: <strong style={{ color: "var(--text)" }}>{examInfo.module_name}</strong></span>
              )}
              <span>Materia: <strong style={{ color: "var(--text)" }}>{examInfo.class_name ?? "—"}</strong></span>
              {result && (
                <span>Calificación:&nbsp;
                  <strong style={{
                    fontSize: 14,
                    color: result.calificacion >= 70 ? GREEN_BD : RED_BD,
                  }}>
                    {result.calificacion.toFixed(2)}
                  </strong>
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{examInfo.title}</h2>
              {/* T37 — Botón Regresar */}
              <button className="btnRegresar" onClick={onClose}>
                ← Volver
              </button>
            </div>
          </div>

          {/* Cuerpo */}
          <div style={{ padding: "20px 24px 36px" }}>
            {loading && <p style={{ color: "var(--muted)", textAlign: "center" }}>Cargando resultado...</p>}
            {errMsg  && <div className="msgError">{errMsg}</div>}

            {result && result.preguntas.map((p, idx) => {
              const studentAns = getStudentAnswer(result, p.id);
              const { correct, earned } = scoreAnswer(p, studentAns);
              return (
                <div key={p.id} className="card" style={{
                  marginBottom: 14,
                  borderLeft: "3px solid var(--stroke)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Pregunta {idx + 1}</span>
                    <span style={{ fontSize: 13, color: correct ? GREEN_BD : RED_BD }}>
                      {earned}/{p.puntos} pts
                    </span>
                  </div>
                  <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.55 }}>{p.enunciado}</p>
                  {(p.tipo === "multiple_single" || p.tipo === "multiple_multi") &&
                    renderMultiple(p, studentAns, p.tipo === "multiple_multi")}
                  {p.tipo === "falso_verdadero"  && renderFV(p, studentAns)}
                  {p.tipo === "emparejamiento"   && renderEmparejamiento(p, studentAns)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
