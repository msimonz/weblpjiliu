"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";

type ClassItem = { id: number; name: string; level: number };

type GradeItem = {
  exam_id: number;
  title: string;
  percent: number;
  grade: number | null;
  finished_at: string | null;
  attempts: number | null;
  source: string | null;
};

const LEVELS = [
  { value: 1, label: "Primer año" },
  { value: 2, label: "Segundo año" },
  { value: 3, label: "Tercer año" },
  { value: 4, label: "Cuarto año" },
];

export default function DashboardPage() {
  const router = useRouter();

  const [me, setMe] = useState<any>(null);
  const [meLoading, setMeLoading] = useState(true);

  const [level, setLevel] = useState<number>(1);

  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<ClassItem[]>([]);
  const [openSug, setOpenSug] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);

  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);

  const [loadingGrades, setLoadingGrades] = useState(false);
  const [items, setItems] = useState<GradeItem[]>([]);
  const [weighted, setWeighted] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);

  // auth guard
  useEffect(() => {
    (async () => {
      setMeLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return router.replace("/login");
        const info = await apiFetch("/api/auth/me");
        setMe(info);
      } catch {
        router.replace("/login");
      } finally {
        setMeLoading(false);
      }
    })();
  }, [router]);

  // reset when level changes
  useEffect(() => {
    setSelectedClass(null);
    setQ("");
    setSuggestions([]);
    setOpenSug(false);
    setItems([]);
    setWeighted(null);
    setError(null);
  }, [level]);

  // autocomplete
  useEffect(() => {
    setError(null);

    if (!q.trim()) {
      setSuggestions([]);
      setOpenSug(false);
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoadingSug(true);
        const res = await apiFetch(
          `/api/student/classes?level=${level}&q=${encodeURIComponent(q.trim())}`
        );
        setSuggestions(res?.items || []);
        setOpenSug(true);
      } catch (e: any) {
        setError(e?.message || "Error buscando materias");
      } finally {
        setLoadingSug(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, level]);

  const canConsult = useMemo(() => !!selectedClass?.id, [selectedClass]);

  function pickClass(c: ClassItem) {
    setSelectedClass(c);
    setQ(c.name);
    setOpenSug(false);
  }

  async function handleConsult() {
    if (!selectedClass?.id) return;
    setError(null);
    setLoadingGrades(true);
    try {
      const res = await apiFetch(
        `/api/student/grades?level=${level}&class_id=${selectedClass.id}`
      );
      setItems(res?.items || []);
      setWeighted(typeof res?.weighted === "number" ? res.weighted : null);
    } catch (e: any) {
      setError(e?.message || "Error consultando notas");
    } finally {
      setLoadingGrades(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (meLoading) return <div className="container">Cargando...</div>;

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brandTitle">JILIU · La Promesa</div>
          <div className="brandSub">Notas y asignaciones</div>
        </div>

        <div className="right">
          <div className="pill">
            {me?.role === "A" ? "Admin" : me?.role === "T" ? "Teacher" : "Student"} ·{" "}
            {me?.user?.email}
          </div>
          <button className="btnSmall" onClick={handleLogout}>
            Salir
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h1>Consultar notas</h1>
          <p className="muted">
            Selecciona el año, busca la materia y consulta tus evaluaciones con ponderado.
          </p>

          {error && <div className="msgError">{error}</div>}

          <div className="formRow">
            <div>
              <div className="label">Año JILIU</div>
              <select
                className="select"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
              >
                {LEVELS.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="autoWrap">
              <div className="label">Materia</div>
              <input
                className="input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSelectedClass(null);
                }}
                placeholder="Escribe: Matemáticas, Inglés, Historia..."
                onFocus={() => q.trim() && setOpenSug(true)}
              />

              {openSug && (suggestions.length > 0 || loadingSug) && (
                <div className="sugBox">
                  {loadingSug && <div className="sugItem muted">Buscando...</div>}
                  {!loadingSug &&
                    suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="sugItem"
                        onClick={() => pickClass(s)}
                      >
                        {s.name}
                      </button>
                    ))}
                  {!loadingSug && suggestions.length === 0 && (
                    <div className="sugItem muted">No hay coincidencias</div>
                  )}
                </div>
              )}
            </div>

            <div className="btnWrap">
              <button className="btn" disabled={!canConsult || loadingGrades} onClick={handleConsult}>
                {loadingGrades ? "Consultando..." : "Consultar"}
              </button>
            </div>
          </div>

          <div className="divider" />

          <div className="resultsHeader">
            <div>
              <div className="label">Materia seleccionada</div>
              <div className="value">
                {selectedClass ? selectedClass.name : <span className="muted">—</span>}
              </div>
            </div>

            <div className="ponderado">
              <div className="label">Ponderado total</div>
              <div className="valueBig">{weighted === null ? "—" : weighted.toFixed(2)}</div>
            </div>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Evaluación</th>
                  <th>%</th>
                  <th>Nota</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      {selectedClass
                        ? "No hay evaluaciones/notas para esta materia en este año."
                        : "Selecciona una materia y consulta."}
                    </td>
                  </tr>
                ) : (
                  items.map((it) => (
                    <tr key={it.exam_id}>
                      <td>{it.title}</td>
                      <td>{Number(it.percent).toFixed(0)}%</td>
                      <td>{it.grade === null ? "—" : Number(it.grade).toFixed(2)}</td>
                      <td>{it.finished_at ? new Date(it.finished_at).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Notas</h2>
          <ul className="list">
            <li>Las sugerencias salen de <b>class</b> filtrado por <b>level</b>.</li>
            <li>El ponderado usa <b>evaluation.percent</b> como peso.</li>
            <li>Si una evaluación no tiene nota aún, sale con “—”.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
