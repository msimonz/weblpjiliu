import { supabaseAdmin } from "../supabase.js";

// ─────────────────────────────────────────────
// Cache en memoria: año lectivo activo
// ─────────────────────────────────────────────
let _cache = { year: null, loadedAt: null };
const TTL_MS = 5 * 60 * 1000; // 5 minutos

export async function getAnioLectivoVigente() {
  const now = Date.now();
  if (_cache.year && now - _cache.loadedAt < TTL_MS) return _cache.year;

  const { data, error } = await supabaseAdmin
    .from("anio_lectivo")
    .select("year")
    .eq("activo", true)
    .single();

  if (error || !data) throw new Error("No hay año lectivo activo configurado");
  _cache = { year: data.year, loadedAt: now };
  return _cache.year;
}

export function invalidarCacheAnioLectivo() {
  _cache = { year: null, loadedAt: null };
}

// ─────────────────────────────────────────────
// Protección de escritura: el id_course debe
// pertenecer al año lectivo vigente.
// Lanza objeto { status, message } si no cumple.
// ─────────────────────────────────────────────
export async function requireAnioVigenteForCourse(id_course) {
  const vigente = await getAnioLectivoVigente();

  const { data, error } = await supabaseAdmin
    .from("course")
    .select("year")
    .eq("id", id_course)
    .single();

  if (error || !data) throw { status: 404, message: "Curso no encontrado" };

  if (data.year !== vigente) {
    throw {
      status: 403,
      message: `Solo se puede modificar el año lectivo vigente (${vigente}). El curso pertenece al año ${data.year}.`,
    };
  }
}

// ─────────────────────────────────────────────
// Protección de escritura: registro de catálogo
// (level, module, group, class, evaluation_type)
// ─────────────────────────────────────────────
export async function requireAnioVigenteForRecord(table, id) {
  const vigente = await getAnioLectivoVigente();

  const { data, error } = await supabaseAdmin
    .from(table)
    .select("year")
    .eq("id", id)
    .single();

  if (error || !data) throw { status: 404, message: `${table}: registro no encontrado` };

  if (data.year !== vigente) {
    throw {
      status: 403,
      message: `Solo se puede modificar el año lectivo vigente (${vigente}). El registro pertenece al año ${data.year}.`,
    };
  }
}

// ─────────────────────────────────────────────
// Shorthand: enviar la respuesta de error desde
// un objeto { status, message } lanzado por los
// helpers anteriores.
// ─────────────────────────────────────────────
export function handleYearError(res, err) {
  const status = err?.status || 500;
  const message = err?.message || "Error interno";
  return res.status(status).json({ error: message });
}
