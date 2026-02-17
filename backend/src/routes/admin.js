import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const adminRouter = Router();

// ===== Middleware: solo Admin =====
function requireAdmin(req, res, next) {
  const r = req.auth?.role || req.auth?.profile?.type || req.auth?.profile?.role;
  if (r !== "A") return res.status(403).json({ error: "Solo Admin" });
  return next();
}

// ===== Multer (upload Excel) =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB
});

// ===== Helpers =====
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function cleanStr(v) {
  return String(v ?? "").trim();
}

// ============================================================================
// 1) COURSES
// ============================================================================
adminRouter.get("/courses", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("course")
    .select("id,name,year,level,created_at")
    .order("level", { ascending: true })
    .order("year", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.post("/courses", requireAuth, requireAdmin, async (req, res) => {
  const name = cleanStr(req.body?.name);
  const level = toInt(req.body?.level);
  const year = req.body?.year; // date string "YYYY-MM-DD" (o null)

  if (!name) return res.status(400).json({ error: "name requerido" });
  if (!level || level < 1 || level > 4) return res.status(400).json({ error: "level inválido (1..4)" });

  const payload = { name, level };
  if (year) payload.year = year;

  const { data, error } = await supabaseAdmin
    .from("course")
    .insert(payload)
    .select("id,name,year,level,created_at")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

// ============================================================================
// 2) CLASSES (materias)
// ============================================================================
adminRouter.get("/classes", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("class")
    .select("id,name,level,created_at")
    .order("level", { ascending: true })
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.post("/classes", requireAuth, requireAdmin, async (req, res) => {
  const name = cleanStr(req.body?.name);
  const level = toInt(req.body?.level);

  if (!name) return res.status(400).json({ error: "name requerido" });
  if (!level || level < 1 || level > 4) return res.status(400).json({ error: "level inválido (1..4)" });

  const { data, error } = await supabaseAdmin
    .from("class")
    .insert({ name, level })
    .select("id,name,level,created_at")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

// ============================================================================
// 3) EVALUATION TYPES
// ============================================================================
adminRouter.get("/evaluation-types", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type,created_at")
    .order("id", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.post("/evaluation-types", requireAuth, requireAdmin, async (req, res) => {
  const type = cleanStr(req.body?.type);
  if (!type) return res.status(400).json({ error: "type requerido" });

  // si existe, devuelve existente
  const { data: ex, error: exErr } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type")
    .eq("type", type)
    .maybeSingle();

  if (exErr) return res.status(500).json({ error: exErr.message });
  if (ex?.id) return res.json({ item: ex });

  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .insert({ type })
    .select("id,type,created_at")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

// ============================================================================
// 4) LISTAR TEACHERS y STUDENTS (para dropdowns)
// ============================================================================
adminRouter.get("/teachers", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,name,email,cedula,type")
    .eq("type", "T")
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.get("/students", requireAuth, requireAdmin, async (req, res) => {
  const q = cleanStr(req.query.q || "");
  let query = supabaseAdmin
    .from("users")
    .select("id,name,email,cedula,type,id_course")
    .eq("type", "S")
    .order("name", { ascending: true })
    .limit(200);

  if (q) {
    // búsqueda simple por nombre/email/cedula
    // Nota: supabase no tiene OR fácil con ilike multiple sin rpc,
    // usamos ilike por name y si no, el front filtra también.
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

// ============================================================================
// 5) ASIGNAR TEACHER A CLASS (class_teacher)
// ============================================================================
adminRouter.post("/assign-teacher", requireAuth, requireAdmin, async (req, res) => {
  const id_teacher = cleanStr(req.body?.id_teacher);
  const id_class = toInt(req.body?.id_class);

  if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
  if (!id_class) return res.status(400).json({ error: "id_class requerido" });

  const { data, error } = await supabaseAdmin
    .from("class_teacher")
    .upsert({ id_teacher, id_class }, { onConflict: "id_teacher,id_class" })
    .select("id_teacher,id_class,created_at")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, item: data });
});

// ============================================================================
// 6) ASIGNAR ALUMNOS A COURSE
// - Actualiza users.id_course
// - Inserta en user_history (histórico) para que luego “cuando cambian de año” quede registro.
// ============================================================================
adminRouter.post("/assign-students", requireAuth, requireAdmin, async (req, res) => {
  const id_course = toInt(req.body?.id_course);
  const student_ids = Array.isArray(req.body?.student_ids) ? req.body.student_ids : [];

  if (!id_course) return res.status(400).json({ error: "id_course requerido" });
  if (student_ids.length === 0) return res.status(400).json({ error: "student_ids requerido" });

  // 1) Actualizar users.id_course en lote
  const { error: upErr } = await supabaseAdmin
    .from("users")
    .update({ id_course })
    .in("id", student_ids);

  if (upErr) return res.status(500).json({ error: upErr.message });

  // 2) Insertar historial (upsert)
  const historyPayload = student_ids.map((id_student) => ({ id_student, id_course }));

  const { error: histErr } = await supabaseAdmin
    .from("user_history")
    .upsert(historyPayload, { onConflict: "id_student,id_course" });

  if (histErr) return res.status(500).json({ error: histErr.message });

  return res.json({ ok: true, updated: student_ids.length });
});

// listado de alumnos en un course (para la tabla)
adminRouter.get("/course-students", requireAuth, requireAdmin, async (req, res) => {
  const courseId = toInt(req.query.course_id);
  if (!courseId) return res.status(400).json({ error: "course_id requerido" });

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,name,email,cedula,type,id_course")
    .eq("type", "S")
    .eq("id_course", courseId)
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

// ============================================================================
// 7) SUBIR EXCEL: crear users en Auth + public.users
// - Password por defecto: "password" (puedes cambiar por ENV DEFAULT_PASSWORD)
// ============================================================================
adminRouter.post("/upload-users", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file requerido (xlsx)" });

    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }); // array objetos

    // Columnas esperadas (mínimo):
    // email, name, type (S/T/A), cedula (opcional), id_course (opcional), code_jiliu (opcional)
    // Puedes poner encabezados en Excel EXACTOS con estos nombres.
    const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "password";

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      items: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};

      const email = cleanStr(r.email || r.Email || r.EMAIL);
      const name = cleanStr(r.name || r.Name || r.NOMBRE);
      const type = cleanStr(r.type || r.Type || r.ROL || "S").toUpperCase();
      const cedula = cleanStr(r.cedula || r.Cedula || r.CEDULA);
      const code_jiliu = cleanStr(r.code_jiliu || r.Code || r.CODIGO);
      const id_course = toInt(r.id_course || r.ID_COURSE || r.course_id);

      if (!email || !email.includes("@")) {
        results.errors.push({ row: i + 2, error: "email inválido" });
        results.skipped++;
        continue;
      }
      if (!name) {
        results.errors.push({ row: i + 2, error: "name requerido" });
        results.skipped++;
        continue;
      }
      if (!["S", "T", "A"].includes(type)) {
        results.errors.push({ row: i + 2, error: "type inválido (S/T/A)" });
        results.skipped++;
        continue;
      }

      // 1) Crear en Auth
      let authUserId = null;

      const createRes = await supabaseAdmin.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { name, type },
      });

      if (createRes?.error) {
        // Si ya existe en Auth, intentamos recuperar por DB users (email)
        // (no hay "getUserByEmail" fácil)
        const msg = createRes.error.message || "Error creando auth user";

        // Intentar upsert en public.users por email si ya existe ahí
        const { data: existing, error: exErr } = await supabaseAdmin
          .from("users")
          .select("id,email")
          .eq("email", email)
          .maybeSingle();

        if (exErr) {
          results.errors.push({ row: i + 2, error: msg });
          results.skipped++;
          continue;
        }

        if (!existing?.id) {
          results.errors.push({ row: i + 2, error: msg });
          results.skipped++;
          continue;
        }

        authUserId = existing.id; // asumimos que coincide con auth.users.id
      } else {
        authUserId = createRes.data.user.id;
      }

      // 2) Insert/Update en public.users
      const payload = {
        id: authUserId,
        email,
        name,
        type,
        cedula: cedula || null,
        code_jiliu: code_jiliu || null,
        id_course: id_course || null,
      };

      // upsert por PK id
      const { data: up, error: upDbErr } = await supabaseAdmin
        .from("users")
        .upsert(payload, { onConflict: "id" })
        .select("id,email,name,type,cedula,id_course")
        .maybeSingle();

      if (upDbErr) {
        results.errors.push({ row: i + 2, error: upDbErr.message });
        results.skipped++;
        continue;
      }

      // 3) si asigna course, registrar history
      if (id_course) {
        const { error: histErr } = await supabaseAdmin
          .from("user_history")
          .upsert({ id_student: authUserId, id_course }, { onConflict: "id_student,id_course" });

        if (histErr) {
          // no es fatal
          results.errors.push({ row: i + 2, error: `history: ${histErr.message}` });
        }
      }

      // contabilizar
      if (createRes?.error) results.updated++;
      else results.created++;

      results.items.push(up);
    }

    return res.json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error procesando Excel" });
  }
});
