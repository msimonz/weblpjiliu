import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const adminRouter = Router();

// ===== Middleware: solo Admin =====
function requireAdmin(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("A")) return res.status(403).json({ error: "Solo Admin" });
  return next();
}

// ===== Multer (upload Excel) =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

// ===== Helpers =====
function toInt(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function cleanStr(v) {
  return String(v ?? "").trim();
}

function isUniqueViolation(err) {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("duplicate key value") || msg.includes("unique constraint");
}

// ===== Cache code -> typeId =====
const typeCache = new Map();

async function getTypeIdByCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) throw new Error("type vacío");
  if (typeCache.has(c)) return typeCache.get(c);

  const { data, error } = await supabaseAdmin
    .from("type")
    .select("id,code")
    .eq("code", c)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(`No existe type '${c}' en tabla type`);

  typeCache.set(c, data.id);
  return data.id;
}

/**
 * Reemplaza completamente los roles del usuario en public.user_type
 */
async function replaceUserRoles(id_user, roleCodes) {
  const codes = (roleCodes || [])
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);

  if (codes.length === 0) throw new Error("roles vacíos");

  const desiredTypeIds = [];
  for (const c of codes) desiredTypeIds.push(await getTypeIdByCode(c));

  const { data: current, error: curErr } = await supabaseAdmin
    .from("user_type")
    .select("id_type")
    .eq("id_user", id_user);

  if (curErr) throw new Error(curErr.message);

  const curSet = new Set((current || []).map((r) => r.id_type));
  const desSet = new Set(desiredTypeIds);

  const toDelete = [...curSet].filter((x) => !desSet.has(x));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("user_type")
      .delete()
      .eq("id_user", id_user)
      .in("id_type", toDelete);

    if (delErr) throw new Error(delErr.message);
  }

  for (const id_type of desiredTypeIds) {
    const { error: upErr } = await supabaseAdmin
      .from("user_type")
      .upsert({ id_user, id_type }, { onConflict: "id_user,id_type" });

    if (upErr) throw new Error(upErr.message);
  }
}


async function getStudentTypeId() {
  const { data, error } = await supabaseAdmin
    .from("type")
    .select("id")
    .eq("code", "S")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("No existe type 'S'");
  return data.id;
}

async function getStudentsByCourseIds(courseIds) {
  const ids = Array.isArray(courseIds)
    ? [...new Set(courseIds.map((x) => Number(x)).filter(Boolean))]
    : [];

  if (ids.length === 0) return [];

  const { data: users, error: uErr } = await supabaseAdmin
    .from("users")
    .select("id,name,cedula,id_course")
    .in("id_course", ids)
    .order("name", { ascending: true });

  if (uErr) throw new Error(uErr.message);
  if (!users?.length) return [];

  const studentTypeId = await getStudentTypeId();

  const { data: roleRows, error: rErr } = await supabaseAdmin
    .from("user_type")
    .select("id_user")
    .eq("id_type", studentTypeId)
    .in("id_user", users.map((u) => u.id));

  if (rErr) throw new Error(rErr.message);

  const studentSet = new Set((roleRows || []).map((r) => r.id_user));
  return (users || []).filter((u) => studentSet.has(u.id));
}

async function resolveEvaluationTypeId(id_type, type_text) {
  let typeId = Number(id_type || 0);
  if (typeId) return typeId;

  const raw = cleanStr(type_text);
  if (!raw) throw new Error("Selecciona un tipo o escribe type_text");

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type")
    .eq("type", raw)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing.id;

  const { data: created, error: crErr } = await supabaseAdmin
    .from("evaluation_type")
    .insert({ type: raw })
    .select("id,type")
    .maybeSingle();

  if (crErr) throw new Error(crErr.message);
  return created.id;
}

// ============================================================================
// 0) LEVELS / MODULES / GROUPS
// ============================================================================
adminRouter.get("/levels", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("level")
    .select("id,name")
    .order("id", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});
adminRouter.get("/modules", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("module")
    .select("id,name")
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.get("/groups", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("group")
    .select("id,name,id_module")
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

// ============================================================================
// 1) COURSES
// ============================================================================
adminRouter.get("/courses", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("course")
    .select("id,name,year,level")
    .order("level", { ascending: true })
    .order("year", { ascending: false })
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const { data: usedRows, error: usedErr } = await supabaseAdmin
    .from("users")
    .select("id_course")
    .not("id_course", "is", null);

  if (usedErr) return res.status(500).json({ error: usedErr.message });

  const usedSet = new Set((usedRows || []).map((r) => String(r.id_course)));
  const items = (data || []).map((c) => ({
    id: c.id,
    name: c.name,
    year: c.year,
    level: c.level,
    user_count: usedSet.has(String(c.id)) ? 1 : 0,
  }));
  return res.json({ items });
});

adminRouter.delete("/courses/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "id inválido" });

  const { count, error: checkErr } = await supabaseAdmin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("id_course", id);

  if (checkErr) return res.status(500).json({ error: checkErr.message });
  if (count > 0) return res.status(409).json({ error: "El curso tiene estudiantes asignados y no puede eliminarse." });

  const { error } = await supabaseAdmin.from("course").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

adminRouter.post("/courses", requireAuth, requireAdmin, async (req, res) => {
  const name = cleanStr(req.body?.name);
  const level = toInt(req.body?.level);
  const year = toInt(req.body?.year);

  if (!name) return res.status(400).json({ error: "name requerido" });
  if (!level) return res.status(400).json({ error: "level requerido" });

  const payload = { name, level };
  if (year) payload.year = year;

  const { data, error } = await supabaseAdmin
    .from("course")
    .insert(payload)
    .select("id,name,year,level")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

// ============================================================================
// 2) CLASSES
// ============================================================================
adminRouter.get("/classes", requireAuth, requireAdmin, async (req, res) => {
  const [
    { data: classData, error: classErr },
    { data: cgData,    error: cgErr },
    { data: grpData,   error: grpErr },
  ] = await Promise.all([
    supabaseAdmin
      .from("class")
      .select("id,name,level,id_module,id_group,created_at,module:module(id,name)")
      .order("level", { ascending: true })
      .order("name",  { ascending: true }),
    supabaseAdmin
      .from("class_group")
      .select("id_class,id_group"),
    supabaseAdmin
      .from("group")
      .select("id,name"),
  ]);

  if (classErr) return res.status(500).json({ error: classErr.message });
  if (cgErr)    return res.status(500).json({ error: cgErr.message });
  if (grpErr)   return res.status(500).json({ error: grpErr.message });

  const grpMap = new Map((grpData || []).map((g) => [g.id, g.name]));

  // id_class → [{ id, name }]
  const cgMap = new Map();
  for (const cg of cgData || []) {
    if (!cgMap.has(cg.id_class)) cgMap.set(cg.id_class, []);
    cgMap.get(cg.id_class).push({ id: cg.id_group, name: grpMap.get(cg.id_group) || "" });
  }

  const items = (classData || []).map((c) => {
    let groups = cgMap.get(c.id) || [];
    // Fallback: si class_group no tiene entrada pero class.id_group está seteado
    if (groups.length === 0 && c.id_group) {
      const grpName = grpMap.get(c.id_group);
      if (grpName) groups = [{ id: c.id_group, name: grpName }];
    }
    return {
      id: c.id,
      name: c.name,
      level: c.level,
      id_module: c.id_module,
      module_name: c.module?.name || null,
      created_at: c.created_at,
      groups,
    };
  });

  return res.json({ items });
});

adminRouter.post("/classes", requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = cleanStr(req.body?.name);
    const level = toInt(req.body?.level);

    let id_module = toInt(req.body?.id_module);
    let id_group = toInt(req.body?.id_group);

    const new_module_name = cleanStr(req.body?.new_module_name);
    const new_group_name = cleanStr(req.body?.new_group_name);

    if (!name) return res.status(400).json({ error: "name requerido" });
    if (!level) return res.status(400).json({ error: "level requerido" });

    // módulo existente o nuevo
    if (!id_module && !new_module_name) {
      return res.status(400).json({ error: "Debes seleccionar un módulo o crear uno nuevo" });
    }

    if (!id_module && new_module_name) {
      const mod = await getOrCreateModuleByName(new_module_name);
      id_module = mod.id;
    } else if (id_module) {
      const { data: mod, error: modErr } = await supabaseAdmin
        .from("module")
        .select("id,name")
        .eq("id", id_module)
        .maybeSingle();

      if (modErr) return res.status(500).json({ error: modErr.message });
      if (!mod?.id) return res.status(404).json({ error: "Módulo no existe" });
    }

    // grupo existente o nuevo (opcional)
    if (!id_group && new_group_name) {
      const grp = await getOrCreateGroupByName(new_group_name);
      id_group = grp.id;
    } else if (id_group) {
      const { data: grp, error: grpErr } = await supabaseAdmin
        .from("group")
        .select("id,name")
        .eq("id", id_group)
        .maybeSingle();

      if (grpErr) return res.status(500).json({ error: grpErr.message });
      if (!grp?.id) return res.status(404).json({ error: "Grupo no existe" });
    }

    const { data: createdClass, error: classErr } = await supabaseAdmin
      .from("class")
      .insert({
        name,
        level,
        id_module,
        ...(id_group ? { id_group } : {}),
      })
      .select("id,name,level,id_module,id_group,created_at")
      .maybeSingle();

    if (classErr) return res.status(500).json({ error: classErr.message });

    if (id_group) {
      const { error: cgErr } = await supabaseAdmin
        .from("class_group")
        .upsert({ id_class: createdClass.id, id_group }, { onConflict: "id_class,id_group" });

      if (cgErr) return res.status(500).json({ error: cgErr.message });
    }

    return res.json({ item: createdClass });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando materia" });
  }
});

// ============================================================================
// 3) EVALUATION TYPES
// ============================================================================
adminRouter.get("/evaluation-types", requireAuth, requireAdmin, async (req, res) => {
  const [{ data, error }, { data: usedRows, error: usedErr }] = await Promise.all([
    supabaseAdmin.from("evaluation_type").select("id,type,created_at").order("id", { ascending: true }),
    supabaseAdmin.from("evaluation").select("id_type"),
  ]);

  if (error) return res.status(500).json({ error: error.message });
  if (usedErr) return res.status(500).json({ error: usedErr.message });

  const usedSet = new Set((usedRows || []).map((r) => String(r.id_type)));
  const items = (data || []).map((t) => ({ ...t, eval_count: usedSet.has(String(t.id)) ? 1 : 0 }));
  return res.json({ items });
});

adminRouter.delete("/evaluation-types/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "id inválido" });

  const { count, error: checkErr } = await supabaseAdmin
    .from("evaluation")
    .select("id", { count: "exact", head: true })
    .eq("id_type", id);

  if (checkErr) return res.status(500).json({ error: checkErr.message });
  if (count > 0) return res.status(409).json({ error: "El tipo tiene evaluaciones asociadas y no puede eliminarse." });

  const { error } = await supabaseAdmin.from("evaluation_type").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

adminRouter.post("/evaluation-types", requireAuth, requireAdmin, async (req, res) => {
  const type = cleanStr(req.body?.type);
  if (!type) return res.status(400).json({ error: "type requerido" });

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
// 4) LISTAR TEACHERS y STUDENTS
// ============================================================================
adminRouter.get("/teachers", requireAuth, requireAdmin, async (req, res) => {
  const level    = toInt(req.query.level);
  const courseId = toInt(req.query.course_id);
  const moduleId = toInt(req.query.module_id);
  const groupId  = toInt(req.query.group_id);
  const classId  = toInt(req.query.class_id);

  const { data: tRow, error: tErr } = await supabaseAdmin
    .from("type")
    .select("id")
    .eq("code", "T")
    .maybeSingle();

  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!tRow?.id) return res.status(500).json({ error: "No existe type 'T'" });

  const { data: ut, error: utErr } = await supabaseAdmin
    .from("user_type")
    .select("id_user")
    .eq("id_type", tRow.id);

  if (utErr) return res.status(500).json({ error: utErr.message });

  let ids = (ut || []).map((r) => r.id_user);
  if (ids.length === 0) return res.json({ items: [] });

  // Filtrar por clase específica
  if (classId) {
    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("id_teacher")
      .eq("id_class", classId)
      .in("id_teacher", ids);
    if (ctErr) return res.status(500).json({ error: ctErr.message });
    ids = ids.filter((id) => new Set((ctRows || []).map((r) => r.id_teacher)).has(id));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (groupId) {
    // Filtrar por grupo: profesores que dictan materias de ese grupo
    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("id_teacher, class:class(id_group)")
      .in("id_teacher", ids);
    if (ctErr) return res.status(500).json({ error: ctErr.message });
    ids = ids.filter((id) => (ctRows || []).some((r) => r.id_teacher === id && Number(r.class?.id_group) === groupId));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (moduleId) {
    // Filtrar por módulo: profesores que dictan materias de ese módulo
    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("id_teacher, class:class(id_module)")
      .in("id_teacher", ids);
    if (ctErr) return res.status(500).json({ error: ctErr.message });
    ids = ids.filter((id) => (ctRows || []).some((r) => r.id_teacher === id && Number(r.class?.id_module) === moduleId));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (courseId) {
    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("id_teacher")
      .eq("id_course", courseId)
      .in("id_teacher", ids);
    if (ctErr) return res.status(500).json({ error: ctErr.message });
    ids = ids.filter((id) => new Set((ctRows || []).map((r) => r.id_teacher)).has(id));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (level) {
    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("id_teacher, class:class(level)")
      .in("id_teacher", ids);
    if (ctErr) return res.status(500).json({ error: ctErr.message });
    ids = ids.filter((id) => (ctRows || []).some((r) => r.id_teacher === id && Number(r.class?.level) === level));
    if (ids.length === 0) return res.json({ items: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,name,email,cedula")
    .in("id", ids)
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.get("/students", requireAuth, requireAdmin, async (req, res) => {
  const q = cleanStr(req.query.q || "");

  const { data: sRow, error: sErr } = await supabaseAdmin
    .from("type")
    .select("id")
    .eq("code", "S")
    .maybeSingle();

  if (sErr) return res.status(500).json({ error: sErr.message });
  if (!sRow?.id) return res.status(500).json({ error: "No existe type 'S'" });

  const { data: ut, error: utErr } = await supabaseAdmin
    .from("user_type")
    .select("id_user")
    .eq("id_type", sRow.id);

  if (utErr) return res.status(500).json({ error: utErr.message });

  const ids = (ut || []).map((r) => r.id_user);
  if (ids.length === 0) return res.json({ items: [] });

  let query = supabaseAdmin
    .from("users")
    .select("id,name,email,cedula,id_course")
    .in("id", ids)
    .order("name", { ascending: true })
    .limit(200);

  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ items: data || [] });
});

// ============================================================================
// 5) ASIGNAR TEACHER A CLASS
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
// 6) GESTIÓN GLOBAL DE EVALUACIONES / NOTAS (ADMIN)
// ============================================================================
adminRouter.get("/courses-by-class", requireAuth, requireAdmin, async (req, res) => {
  try {
    const classId = toInt(req.query.class_id);
    if (!classId) return res.status(400).json({ error: "class_id requerido" });

    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("class")
      .select("id,name,level")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { data: courses, error: cErr } = await supabaseAdmin
      .from("course")
      .select("id,name,level,year")
      .eq("level", cls.level)
      .order("level", { ascending: true })
      .order("id", { ascending: true });

    if (cErr) return res.status(500).json({ error: cErr.message });

    return res.json({ items: courses || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo cursos" });
  }
});

adminRouter.get("/evaluations", requireAuth, requireAdmin, async (req, res) => {
  try {
    const classId = toInt(req.query.class_id);
    const level = toInt(req.query.level);
    const courseId = toInt(req.query.course_id);
    const teacherId = cleanStr(req.query.teacher_id);
    const moduleId = toInt(req.query.module_id);
    const groupId = toInt(req.query.group_id);

    let q = supabaseAdmin
      .from("evaluation")
      .select(`
        id,
        title,
        percent,
        created_at,
        id_course,
        id_class,
        id_type,
        id_teacher,
        id_module,
        id_group,
        course:course(id,name,level,year),
        class:class(id,name,level,id_module),
        evaluation_type:evaluation_type(id,type),
        teacher:users!id_teacher(id,name),
        module:module(id,name),
        group:group(id,name)
      `)
      .order("created_at", { ascending: false });

    if (classId) q = q.eq("id_class", classId);
    if (courseId) q = q.eq("id_course", courseId);
    if (teacherId) q = q.eq("id_teacher", teacherId);
    if (moduleId) q = q.eq("id_module", moduleId);
    if (groupId) q = q.eq("id_group", groupId);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    let items = data || [];
    if (level) {
      items = items.filter((it) => {
        if (it?.class?.level) return Number(it.class.level) === level;
        if (it?.course?.level) return Number(it.course.level) === level;
        return false;
      });
    }

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error listando evaluaciones" });
  }
});

adminRouter.get("/class-grade-grid", requireAuth, requireAdmin, async (req, res) => {
  try {
    const classId = toInt(req.query.class_id);
    const teacherId = cleanStr(req.query.teacher_id);
    const courseId = toInt(req.query.course_id);

    if (!classId) return res.status(400).json({ error: "class_id requerido" });

    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("class")
      .select("id,name,level")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    let evQuery = supabaseAdmin
      .from("evaluation")
      .select(`
        id,
        title,
        percent,
        created_at,
        id_course,
        id_class,
        id_type,
        id_teacher,
        course:course(id,name,level,year),
        class:class(id,name,level),
        evaluation_type:evaluation_type(id,type)
      `)
      .eq("id_class", classId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (teacherId) evQuery = evQuery.eq("id_teacher", teacherId);
    if (courseId) evQuery = evQuery.eq("id_course", courseId);

    const { data: evaluations, error: evErr } = await evQuery;
    if (evErr) return res.status(500).json({ error: evErr.message });

    const evals = evaluations || [];

    const courseIds = courseId
      ? [courseId]
      : [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];

    const studentsRaw = await getStudentsByCourseIds(courseIds);

    const { data: courses, error: cErr } = courseIds.length
      ? await supabaseAdmin
          .from("course")
          .select("id,name")
          .in("id", courseIds)
      : { data: [], error: null };

    if (cErr) return res.status(500).json({ error: cErr.message });

    const courseNameMap = new Map((courses || []).map((c) => [Number(c.id), c.name]));

    const students = (studentsRaw || []).map((u) => ({
      id: u.id,
      name: u.name,
      cedula: u.cedula,
      id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    const examIds = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);

    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,finished_at,attempts,created_at,updated_at")
        .in("id_exam", examIds)
        .in("id_student", studentIds);

      if (gErr) return res.status(500).json({ error: gErr.message });
      grades = gRows || [];
    }

    return res.json({
      class: cls,
      evaluations: evals,
      students,
      grades,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error generando grid" });
  }
});

// Flexible grade grid: all params optional
// level=0 or omit = all levels; course_id omit = all courses; class_id omit = all classes
adminRouter.get("/grade-grid", requireAuth, requireAdmin, async (req, res) => {
  try {
    const classId  = toInt(req.query.class_id);
    const courseId = toInt(req.query.course_id);
    const level    = toInt(req.query.level); // 0 or omit = all levels

    // 1. Resolve which classes to include
    let classQuery = supabaseAdmin.from("class").select("id,name,level");
    if (classId)             classQuery = classQuery.eq("id", classId);
    else if (level && level > 0) classQuery = classQuery.eq("level", level);
    classQuery = classQuery.order("level").order("name");

    const { data: classRows, error: clsErr } = await classQuery;
    if (clsErr) return res.status(500).json({ error: clsErr.message });
    const classIds = (classRows || []).map((c) => c.id);
    if (classIds.length === 0)
      return res.json({ classes: [], evaluations: [], students: [], grades: [] });

    // 2. Get evaluations for those classes
    let evQuery = supabaseAdmin
      .from("evaluation")
      .select(`id,title,percent,created_at,id_course,id_class,id_type,id_teacher,
        course:course(id,name,level,year),
        class:class(id,name,level),
        evaluation_type:evaluation_type(id,type)`)
      .in("id_class", classIds)
      .order("id_class", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (courseId) evQuery = evQuery.eq("id_course", courseId);

    const { data: evaluations, error: evErr } = await evQuery;
    if (evErr) return res.status(500).json({ error: evErr.message });
    const evals = evaluations || [];

    // 3. Resolve course IDs for student lookup
    let courseIds = courseId
      ? [courseId]
      : [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];

    // If still empty (no evals yet), fall back to courses of the level
    if (courseIds.length === 0) {
      let cq = supabaseAdmin.from("course").select("id");
      if (courseId)            cq = cq.eq("id", courseId);
      else if (level && level > 0) cq = cq.eq("level", level);
      const { data: cRows } = await cq;
      courseIds = (cRows || []).map((c) => Number(c.id));
    }

    // 4. Students
    const studentsRaw = await getStudentsByCourseIds(courseIds);
    let { data: coursesInfo } = courseIds.length
      ? await supabaseAdmin.from("course").select("id,name").in("id", courseIds)
      : { data: [] };
    const courseNameMap = new Map((coursesInfo || []).map((c) => [Number(c.id), c.name]));
    const students = (studentsRaw || []).map((u) => ({
      id: u.id, name: u.name, cedula: u.cedula, id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    // 5. Grades
    const examIds    = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);
    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,finished_at,attempts,created_at,updated_at")
        .in("id_exam", examIds)
        .in("id_student", studentIds);
      if (gErr) return res.status(500).json({ error: gErr.message });
      grades = gRows || [];
    }

    return res.json({
      class: classId ? (classRows[0] || null) : null,
      classes: classRows,
      evaluations: evals,
      students,
      grades,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error generando grid" });
  }
});

adminRouter.get("/exam-grades", requireAuth, requireAdmin, async (req, res) => {
  try {
    const examId = toInt(req.query.exam_id);
    if (!examId) return res.status(400).json({ error: "exam_id requerido" });

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id")
      .eq("id", examId)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    const { data, error } = await supabaseAdmin
      .from("grades")
      .select("id_student,grade,finished_at,attempts,created_at,updated_at")
      .eq("id_exam", examId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo notas" });
  }
});

adminRouter.post("/evaluations", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_course = toInt(req.body?.id_course);
    const id_class = toInt(req.body?.id_class);
    // id_teacher es opcional desde admin; si no se envía se usa el propio admin
    const id_teacher = cleanStr(req.body?.id_teacher) || req.auth.user.id;
    const percent = Number(req.body?.percent);
    const title = cleanStr(req.body?.title);
    const id_type = toInt(req.body?.id_type);
    const type_text = cleanStr(req.body?.type_text);

    if (!id_course || !id_class) {
      return res.status(400).json({ error: "Faltan campos: id_course, id_class" });
    }

    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return res.status(400).json({ error: "percent inválido (1..100)" });
    }

    if (!title) {
      return res.status(400).json({ error: "title requerido" });
    }

    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("class")
      .select("id,name,level,id_module,id_group")
      .eq("id", id_class)
      .maybeSingle();

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { data: course, error: cErr } = await supabaseAdmin
      .from("course")
      .select("id,name,level,year")
      .eq("id", id_course)
      .maybeSingle();

    if (cErr) return res.status(500).json({ error: cErr.message });
    if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

    if (Number(course.level) !== Number(cls.level)) {
      return res.status(400).json({
        error: "El curso seleccionado no corresponde al mismo level de la materia",
      });
    }

    const typeId = await resolveEvaluationTypeId(id_type, type_text);

    const { data, error } = await supabaseAdmin
      .from("evaluation")
      .insert({
        id_course,
        id_class,
        id_teacher,
        id_type: typeId,
        percent,
        title,
        id_module: cls.id_module || null,
        id_group: cls.id_group || null,
      })
      .select("id,title,percent,created_at,id_course,id_class,id_type,id_teacher")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando evaluación" });
  }
});

adminRouter.post("/grades", requireAuth, requireAdmin, async (req, res) => {
  try {
    const examId = toInt(req.body?.exam_id);
    const ced = cleanStr(req.body?.student_cedula);
    const grade = Number(req.body?.grade);

    if (!examId) return res.status(400).json({ error: "exam_id requerido" });
    if (!ced) return res.status(400).json({ error: "student_cedula requerida" });
    if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
      return res.status(400).json({ error: "grade inválida (0..100)" });
    }

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id,id_course")
      .eq("id", examId)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    const { data: st, error: stErr } = await supabaseAdmin
      .from("users")
      .select("id,cedula,name,email,id_course")
      .eq("cedula", ced)
      .maybeSingle();

    if (stErr) return res.status(500).json({ error: stErr.message });
    if (!st?.id) return res.status(404).json({ error: "No existe estudiante con esa cédula" });

    if (Number(st.id_course) !== Number(ev.id_course)) {
      return res.status(400).json({ error: "El estudiante no pertenece al curso de esta evaluación" });
    }

    const payload = {
      id_exam: examId,
      id_student: st.id,
      grade,
      finished_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("grades")
      .upsert(payload, { onConflict: "id_exam,id_student" })
      .select("id_exam,id_student,grade,finished_at")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ok: true,
      student: { id: st.id, cedula: st.cedula, name: st.name },
      grade: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error subiendo nota" });
  }
});

adminRouter.patch("/evaluations/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id,id_class,id_course,id_teacher,id_type,title,percent")
      .eq("id", id)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    const payload = {};

    if (req.body?.percent !== undefined) {
      const percent = Number(req.body.percent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        return res.status(400).json({ error: "Percent inválido (1..100)" });
      }
      payload.percent = percent;
    }

    if (req.body?.title !== undefined) {
      const title = cleanStr(req.body.title);
      if (!title) return res.status(400).json({ error: "title inválido" });
      payload.title = title;
    }

    if (req.body?.id_type !== undefined || req.body?.type_text !== undefined) {
      payload.id_type = await resolveEvaluationTypeId(req.body?.id_type, req.body?.type_text);
    }

    if (req.body?.id_teacher !== undefined) {
      const id_teacher = cleanStr(req.body.id_teacher);
      if (!id_teacher) return res.status(400).json({ error: "id_teacher inválido" });

      // Solo validar class_teacher para evaluaciones de nivel materia
      if (ev.id_class) {
        const { data: link, error: linkErr } = await supabaseAdmin
          .from("class_teacher")
          .select("id_teacher,id_class")
          .eq("id_teacher", id_teacher)
          .eq("id_class", ev.id_class)
          .maybeSingle();

        if (linkErr) return res.status(500).json({ error: linkErr.message });
        if (!link?.id_teacher) {
          return res.status(400).json({ error: "Ese profesor no está asignado a esa materia" });
        }
      }

      payload.id_teacher = id_teacher;
    }

    if (req.body?.id_course !== undefined) {
      const id_course = toInt(req.body.id_course);
      if (!id_course) return res.status(400).json({ error: "id_course inválido" });

      const { data: cls, error: clsErr } = await supabaseAdmin
        .from("class")
        .select("id,level")
        .eq("id", ev.id_class)
        .maybeSingle();

      if (clsErr) return res.status(500).json({ error: clsErr.message });
      if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

      const { data: course, error: cErr } = await supabaseAdmin
        .from("course")
        .select("id,level")
        .eq("id", id_course)
        .maybeSingle();

      if (cErr) return res.status(500).json({ error: cErr.message });
      if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

      if (Number(course.level) !== Number(cls.level)) {
        return res.status(400).json({
          error: "El curso seleccionado no corresponde al mismo level de la materia",
        });
      }

      payload.id_course = id_course;
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const { data, error } = await supabaseAdmin
      .from("evaluation")
      .update(payload)
      .eq("id", id)
      .select("id,title,percent,id_type,id_teacher,id_course,id_class,created_at")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando evaluación" });
  }
});


adminRouter.delete("/evaluations/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    const { error } = await supabaseAdmin
      .from("evaluation")
      .delete()
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error eliminando evaluación" });
  }
});

// POST /api/admin/evaluations/bulk — crear evaluaciones por módulo o grupo
// scope: "module" | "group"
adminRouter.post("/evaluations/bulk", requireAuth, requireAdmin, async (req, res) => {
  try {
    const scope = cleanStr(req.body?.scope);
    if (scope !== "module" && scope !== "group") {
      return res.status(400).json({ error: "scope debe ser 'module' o 'group'" });
    }

    const id_module = toInt(req.body?.id_module);
    const id_group = toInt(req.body?.id_group);
    const id_course = toInt(req.body?.id_course);
    const id_teacher = cleanStr(req.body?.id_teacher);
    const percent = Number(req.body?.percent);
    const title = cleanStr(req.body?.title);
    const id_type = toInt(req.body?.id_type);
    const type_text = cleanStr(req.body?.type_text);

    if (scope === "module" && !id_module) {
      return res.status(400).json({ error: "id_module requerido para scope=module" });
    }
    if (scope === "group" && !id_group) {
      return res.status(400).json({ error: "id_group requerido para scope=group" });
    }
    if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return res.status(400).json({ error: "percent inválido (1..100)" });
    }
    if (!title) return res.status(400).json({ error: "title requerido" });

    const typeId = await resolveEvaluationTypeId(id_type, type_text);

    // Una sola evaluación vinculada al módulo o grupo directamente
    const row = {
      id_course: id_course || null,
      id_teacher,
      id_type: typeId,
      percent,
      title,
      ...(scope === "module" ? { id_module } : { id_group, ...(id_module ? { id_module } : {}) }),
    };

    const { data, error } = await supabaseAdmin
      .from("evaluation")
      .insert(row)
      .select("id,title,percent,id_course,id_class,id_type,id_teacher,id_module,id_group,created_at")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error en creación masiva de evaluaciones" });
  }
});

// ============================================================================
// 7a) DESCARGAR PLANTILLA
// ============================================================================
adminRouter.get("/download-template", requireAuth, requireAdmin, async (req, res) => {
  try {
    const TYPE_COMBOS = [
      "S", "T", "A", "M",
      "S,T", "S,A", "S,M", "T,A", "T,M", "A,M",
      "S,T,A", "S,T,M", "S,A,M", "T,A,M",
      "S,T,A,M",
    ];

    // Traer cursos de la BD
    const { data: courses } = await supabaseAdmin
      .from("course")
      .select("id, name")
      .order("name");

    const courseNames = (courses || []).map((c) => c.name);
    const typeRows    = TYPE_COMBOS.length;
    const courseRows  = courseNames.length;

    const wb = new ExcelJS.Workbook();

    // ── Hoja oculta _listas ──
    const wsLists = wb.addWorksheet("_listas", { state: "veryHidden" });
    TYPE_COMBOS.forEach((v, i)  => { wsLists.getCell(`A${i + 1}`).value = v; });
    courseNames.forEach((v, i)  => { wsLists.getCell(`B${i + 1}`).value = v; });

    // ── Hoja principal (debe agregarse DESPUÉS de _listas para que quede activa) ──
    const ws = wb.addWorksheet("Personas");
    ws.columns = [
      { header: "name",       key: "name",       width: 28 },
      { header: "cedula",     key: "cedula",      width: 16 },
      { header: "email",      key: "email",       width: 32 },
      { header: "type",       key: "type",        width: 12 },
      { header: "code_jiliu", key: "code_jiliu",  width: 14 },
      { header: "curso",      key: "curso",       width: 14 },
    ];

    // Estilo encabezado
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    // Filas de ejemplo — Orden: name | cedula | email | type | code_jiliu | curso
    ws.addRow(["Juan Pérez",   "10001234", "juan@ejemplo.com",   "S",   "9001", courseNames[0] ?? ""]);
    ws.addRow(["María López",  "20005678", "maria@ejemplo.com",  "T",   "",     ""]);
    ws.addRow(["Carlos Admin", "30009012", "carlos@ejemplo.com", "A",   "",     ""]);
    ws.addRow(["Ana Dual",     "40003456", "ana@ejemplo.com",    "S,T", "9002", courseNames[0] ?? ""]);

    // Validación columna D (type)
    ws.dataValidations.add("D2:D200", {
      type: "list",
      allowBlank: false,
      formulae: [`_listas!$A$1:$A$${typeRows}`],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Tipo inválido",
      error: "Selecciona un tipo de la lista desplegable",
    });

    // Validación columna F (curso)
    if (courseRows > 0) {
      ws.dataValidations.add("F2:F200", {
        type: "list",
        allowBlank: true,
        formulae: [`_listas!$B$1:$B$${courseRows}`],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Curso inválido",
        error: "Selecciona un curso de la lista desplegable",
      });
    }

    // Protección: desbloquear columnas editables (A,B,C,E) y dejar bloqueadas D y F
    for (let row = 2; row <= 200; row++) {
      ["A", "B", "C", "E"].forEach((col) => {
        ws.getCell(`${col}${row}`).protection = { locked: false };
      });
    }
    // Proteger la hoja: permite seleccionar y editar celdas desbloqueadas e insertar filas
    await ws.protect("", {
      selectLockedCells: true,
      selectUnlockedCells: true,
      insertRows: true,
      deleteRows: true,
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="plantilla_personas.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ error: e?.message || "Error generando plantilla" });
  }
});

// ============================================================================
// 7) SUBIR EXCEL
// ============================================================================
adminRouter.post("/upload-users", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file requerido (xlsx)" });

    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: "El Excel no tiene hojas" });

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "123456";

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      items: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const rowNum = i + 2;

      const email = cleanStr(r.email || r.Email || r.EMAIL).toLowerCase();
      const name = cleanStr(r.name || r.Name || r.NOMBRE);

      const typeRaw = cleanStr(r.type || r.Type || r.ROL).toUpperCase();
      const typeList = typeRaw.split(",").map((x) => x.trim()).filter(Boolean);

      const cedula = cleanStr(r.cedula || r.Cedula || r.CEDULA);
      let code_jiliu = cleanStr(r.code_jiliu || r.Code || r.CODIGO || r.CODE_JILIU);

      // Resolver curso: la plantilla trae el nombre del curso, no el id
      const courseNameRaw = cleanStr(r.curso || r.Curso || r.CURSO || r.id_course || r.ID_COURSE || r.course_id || r.COURSE_ID);
      let id_course = null;
      if (courseNameRaw) {
        // Intentar primero por nombre, luego por id numérico (compatibilidad)
        const { data: courseMatch } = await supabaseAdmin
          .from("course")
          .select("id")
          .eq("name", courseNameRaw)
          .maybeSingle();
        if (courseMatch) {
          id_course = courseMatch.id;
        } else {
          const asInt = toInt(courseNameRaw);
          if (asInt) id_course = asInt;
        }
      }

      if (!email || !email.includes("@")) {
        results.errors.push({ row: rowNum, error: "email inválido" });
        results.skipped++;
        continue;
      }
      if (!name) {
        results.errors.push({ row: rowNum, error: "name requerido" });
        results.skipped++;
        continue;
      }
      if (typeList.length === 0 || typeList.some((t) => !["S", "T", "A", "M"].includes(t))) {
        results.errors.push({ row: rowNum, error: "type inválido (S/T/A/M o combinación, ej: S,T)" });
        results.skipped++;
        continue;
      }
      if (!cedula) {
        results.errors.push({ row: rowNum, error: "cedula requerida" });
        results.skipped++;
        continue;
      }
      if (!/^\d+$/.test(cedula)) {
        results.errors.push({ row: rowNum, error: "cedula debe contener solo números" });
        results.skipped++;
        continue;
      }
      // Validar duplicado de cédula en BD
      const { data: cedulaDup } = await supabaseAdmin
        .from("users")
        .select("id,email")
        .eq("cedula", cedula)
        .maybeSingle();
      if (cedulaDup && cedulaDup.email !== email) {
        results.errors.push({ row: rowNum, error: `cedula ${cedula} ya está registrada para otro usuario (${cedulaDup.email})` });
        results.skipped++;
        continue;
      }

      const needsStudentFields = typeList.includes("S") || typeList.includes("M");
      if (needsStudentFields && !code_jiliu) {
        results.errors.push({ row: rowNum, error: "code_jiliu requerido para rol S o M" });
        results.skipped++;
        continue;
      } else if (needsStudentFields && !/^\d+$/.test(code_jiliu)) {
        results.errors.push({ row: rowNum, error: "code_jiliu debe contener solo números" });
        results.skipped++;
        continue;
      } else if (needsStudentFields && !id_course) {
        results.errors.push({ row: rowNum, error: "curso requerido para rol S o M" });
        results.skipped++;
        continue;
      } else if (!needsStudentFields) {
        code_jiliu = null;
        id_course = null;
      }

      let authUserId = null;

      const createRes = await supabaseAdmin.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { name, roles: typeList },
      });

      if (createRes?.error) {
        const msg = createRes.error.message || "Error creando auth user";

        const { data: existing, error: exErr } = await supabaseAdmin
          .from("users")
          .select("id,email")
          .eq("email", email)
          .maybeSingle();

        if (exErr) {
          results.errors.push({ row: rowNum, error: msg });
          results.skipped++;
          continue;
        }

        if (!existing?.id) {
          results.errors.push({
            row: rowNum,
            error: `${msg} (y no existe registro en public.users para ese email)`,
          });
          results.skipped++;
          continue;
        }

        authUserId = existing.id;
      } else {
        authUserId = createRes.data.user.id;
      }

      const payload = {
        id: authUserId,
        email,
        name,
        cedula,
        code_jiliu,
        id_course,
      };

      const { data: up, error: upDbErr } = await supabaseAdmin
        .from("users")
        .upsert(payload, { onConflict: "id" })
        .select("id,email,name,cedula,code_jiliu,id_course")
        .maybeSingle();

      if (upDbErr) {
        results.errors.push({ row: rowNum, error: upDbErr.message });
        results.skipped++;
        continue;
      }

      try {
        await replaceUserRoles(authUserId, typeList);
      } catch (e) {
        results.errors.push({ row: rowNum, error: `roles: ${e?.message || "error reemplazando roles"}` });
      }

      if (createRes?.error) {
        const updAuth = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
          user_metadata: { name, roles: typeList },
        });
        if (updAuth?.error) {
          results.errors.push({ row: rowNum, error: `auth metadata: ${updAuth.error.message}` });
        }
      }

      if (!(payload.id_course == null)) {
        const { error: histErr } = await supabaseAdmin
          .from("user_history")
          .upsert({ id_student: authUserId, id_course }, { onConflict: "id_student,id_course" });
        if (histErr) {
          results.errors.push({ row: rowNum, error: `history: ${histErr.message}` });
        }
      }

      if (createRes?.error) results.updated++;
      else results.created++;

      results.items.push(up);
    }

    return res.json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error procesando Excel" });
  }
});

// ============================================================================
// 7b) BUSCAR USUARIO POR CÉDULA
// ============================================================================
adminRouter.get("/user-by-cedula", requireAuth, requireAdmin, async (req, res) => {
  try {
    const cedula = cleanStr(req.query?.cedula || "");
    if (!cedula) return res.status(400).json({ error: "cedula requerida" });

    const { data: u, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, name, email, cedula, code_jiliu, id_course")
      .eq("cedula", cedula)
      .maybeSingle();

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!u) return res.status(404).json({ error: "No encontrado" });

    const { data: ut } = await supabaseAdmin
      .from("user_type")
      .select("id_type, type(code)")
      .eq("id_user", u.id);

    const roles = (ut || []).map((r) => r.type?.code).filter(Boolean);

    return res.json({ ok: true, user: { ...u, roles } });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error buscando usuario" });
  }
});

// ============================================================================
// 8) CREAR USUARIO MANUAL
// ============================================================================
adminRouter.post("/create-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = cleanStr(req.body?.email).toLowerCase();
    const name = cleanStr(req.body?.name);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
    const cedula = cleanStr(req.body?.cedula);
    let code_jiliu = cleanStr(req.body?.code_jiliu);
    let id_course = toInt(req.body?.id_course);

    if (!email || !email.includes("@")) return res.status(400).json({ error: "email inválido" });
    if (!name) return res.status(400).json({ error: "name requerido" });

    if (roles.length === 0 || roles.some((r) => !["S", "T", "A", "M"].includes(String(r).toUpperCase()))) {
      return res.status(400).json({ error: "roles inválidos (S/T/A/M)" });
    }
    const roleList = roles.map((r) => String(r).toUpperCase());

    const needsStudentFields = roleList.includes("S") || roleList.includes("M");
    if (needsStudentFields && !code_jiliu) {
      return res.status(400).json({ error: "code_jiliu requerido para rol S o M" });
    } else if (needsStudentFields && !id_course) {
      return res.status(400).json({ error: "id_course requerido para rol S o M" });
    } else if (!needsStudentFields) {
      id_course = null;
      code_jiliu = null;
    }

    if (!cedula) return res.status(400).json({ error: "cedula requerida" });
    const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "password";

    let authUserId = null;

    const createRes = await supabaseAdmin.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { name, roles: roleList },
    });

    if (createRes?.error) {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("users")
        .select("id,email")
        .eq("email", email)
        .maybeSingle();

      if (exErr) return res.status(500).json({ error: exErr.message });
      if (!existing?.id) {
        return res.status(400).json({
          error: (createRes.error.message || "No se pudo crear") + " (y no existe en public.users)",
        });
      }

      authUserId = existing.id;

      const updAuth = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        email,
        user_metadata: { name, roles: roleList },
      });
      if (updAuth?.error) {
        console.warn("[create-user] WARN auth update:", updAuth.error.message);
      }
    } else {
      authUserId = createRes.data.user.id;
    }

    const payload = {
      id: authUserId,
      email,
      name,
      cedula,
      code_jiliu,
      id_course,
    };

    const { data: up, error: upDbErr } = await supabaseAdmin
      .from("users")
      .upsert(payload, { onConflict: "id" })
      .select("id,email,name,cedula,code_jiliu,id_course")
      .maybeSingle();

    if (upDbErr) return res.status(500).json({ error: upDbErr.message });

    await replaceUserRoles(authUserId, roleList);

    if (!(payload.id_course == null)) {
      const { error: histErr } = await supabaseAdmin
        .from("user_history")
        .upsert({ id_student: authUserId, id_course }, { onConflict: "id_student,id_course" });

      if (histErr) {
        return res.json({ ok: true, item: up, warn: `history: ${histErr.message}`, created: !createRes?.error });
      }
    }

    return res.json({ ok: true, item: up, created: !createRes?.error });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando usuario" });
  }
});

// ============================================================================
// 9) ACTUALIZAR USUARIO POR CÉDULA
// ============================================================================
adminRouter.post("/update-user-by-cedula", requireAuth, requireAdmin, async (req, res) => {
  try {
    const cedula = cleanStr(req.body?.cedula);
    const email = cleanStr(req.body?.email).toLowerCase();
    const name = cleanStr(req.body?.name);
    let code_jiliu = cleanStr(req.body?.code_jiliu);
    let id_course = toInt(req.body?.id_course);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];

    if (!cedula) return res.status(400).json({ error: "cedula requerida" });
    if (!email || !email.includes("@")) return res.status(400).json({ error: "email inválido" });
    if (!name) return res.status(400).json({ error: "name requerido" });

    if (roles.length === 0 || roles.some((r) => !["S", "T", "A", "M"].includes(String(r).toUpperCase()))) {
      return res.status(400).json({ error: "roles inválidos (S/T/A/M)" });
    }

    const roleList = roles.map((r) => String(r).toUpperCase());

    const needsStudentFields = roleList.includes("S") || roleList.includes("M");
    if (needsStudentFields && !code_jiliu) {
      return res.status(400).json({ error: "code_jiliu requerido para rol S o M" });
    } else if (needsStudentFields && !id_course) {
      return res.status(400).json({ error: "id_course requerido para rol S o M" });
    } else if (!needsStudentFields) {
      id_course = null;
      code_jiliu = null;
    }

    const { data: u, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id,cedula,email")
      .eq("cedula", cedula)
      .maybeSingle();

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado con esa cédula" });

    const userId = u.id;
    const oldEmail = (u.email || "").toLowerCase();

    const { data: codeDup, error: codeDupErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("code_jiliu", code_jiliu)
      .neq("id", userId)
      .limit(1);

    if (codeDupErr) return res.status(500).json({ error: codeDupErr.message });
    if (Array.isArray(codeDup) && codeDup.length > 0) {
      return res.status(409).json({ error: "Ese code_jiliu ya está en uso por otro usuario." });
    }

    const { data: emailDup, error: emailDupErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .neq("id", userId)
      .limit(1);

    if (emailDupErr) return res.status(500).json({ error: emailDupErr.message });
    if (Array.isArray(emailDup) && emailDup.length > 0) {
      return res.status(409).json({ error: "Ese email ya está en uso por otro usuario." });
    }

    let warn = null;

    const authPayload = {
      user_metadata: { name, roles: roleList },
    };

    if (email !== oldEmail) {
      authPayload.email = email;
      authPayload.email_confirm = true;
    }

    const authUpd = await supabaseAdmin.auth.admin.updateUserById(userId, authPayload);

    if (authUpd?.error) {
      const msg = authUpd.error.message || "No se pudo actualizar el email en Auth";
      return res.status(400).json({ error: `Auth: ${msg}` });
    }

    const { data: up, error: upErr } = await supabaseAdmin
      .from("users")
      .update({ email, name, code_jiliu, id_course })
      .eq("id", userId)
      .select("id,email,name,cedula,code_jiliu,id_course")
      .maybeSingle();

    if (upErr) {
      if (isUniqueViolation(upErr)) {
        return res.status(409).json({ error: "Conflicto: email o code_jiliu ya existen." });
      }
      return res.status(500).json({ error: upErr.message });
    }

    await replaceUserRoles(userId, roleList);

    const { error: histErr } = await supabaseAdmin
      .from("user_history")
      .upsert({ id_student: userId, id_course }, { onConflict: "id_student,id_course" });

    if (histErr) warn = `history: ${histErr.message}`;

    return res.json({ ok: true, item: up, warn });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando usuario" });
  }
});

// ============================================================================
// GET /api/admin/user-by-cedula
// ============================================================================
adminRouter.get("/user-by-cedula", requireAuth, requireAdmin, async (req, res) => {
  try {
    const cedula = cleanStr(req.query?.cedula);
    if (!cedula) return res.status(400).json({ error: "cedula requerida" });

    const { data: u, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id,email,name,cedula,code_jiliu,id_course")
      .eq("cedula", cedula)
      .maybeSingle();

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado" });

    const { data: roleRows, error: rErr } = await supabaseAdmin
      .from("user_type")
      .select("id_type, type: type(id,code)")
      .eq("id_user", u.id);

    if (rErr) return res.status(500).json({ error: rErr.message });

    const roles = (roleRows || []).map((r) => r?.type?.code).filter(Boolean);

    return res.json({ ok: true, item: { ...u, roles } });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error buscando usuario" });
  }
});

async function getOrCreateModuleByName(name) {
  const cleanName = cleanStr(name);
  if (!cleanName) throw new Error("Nombre de módulo requerido");

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("module")
    .select("id,name")
    .ilike("name", cleanName)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing;

  const { data: created, error: crErr } = await supabaseAdmin
    .from("module")
    .insert({ name: cleanName })
    .select("id,name")
    .maybeSingle();

  if (crErr) throw new Error(crErr.message);
  return created;
}

async function getOrCreateGroupByName(name) {
  const cleanName = cleanStr(name);
  if (!cleanName) throw new Error("Nombre de grupo requerido");

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("group")
    .select("id,name")
    .ilike("name", cleanName)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing;

  const { data: created, error: crErr } = await supabaseAdmin
    .from("group")
    .insert({ name: cleanName })
    .select("id,name")
    .maybeSingle();

  if (crErr) throw new Error(crErr.message);
  return created;
}
// ============================================================================
// 6) DESASIGNAR TEACHER DE CLASS
// ============================================================================
adminRouter.post("/unassign-teacher", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_teacher = cleanStr(req.body?.id_teacher);
    const id_class = toInt(req.body?.id_class);

    if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
    if (!id_class) return res.status(400).json({ error: "id_class requerido" });

    const { error } = await supabaseAdmin
      .from("class_teacher")
      .delete()
      .eq("id_teacher", id_teacher)
      .eq("id_class", id_class);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error desasignando teacher" });
  }
});

// ============================================================================
// DELETE /api/admin/delete-user
// ============================================================================
adminRouter.delete("/delete-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    const cedula = cleanStr(req.body?.cedula || req.query?.cedula || "");
    if (!cedula) return res.status(400).json({ error: "cedula requerida" });

    const { data: u, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("cedula", cedula)
      .maybeSingle();

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado con esa cédula" });

    // Eliminar de Supabase Auth (también elimina sesiones activas)
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
    if (authErr) return res.status(500).json({ error: authErr.message });

    // La tabla users y relacionadas se limpian por CASCADE en la BD
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error eliminando usuario" });
  }
});

// ============================================================================
// 7) GRID ASIGNACIÓN MATERIAS-PROFESOR POR CURSO
// ============================================================================
adminRouter.get("/assignment-grid", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_course = toInt(req.query.id_course);
    const id_level  = toInt(req.query.id_level);

    // 1) Determine courses scope
    let coursesQuery = supabaseAdmin.from("course").select("id,name,level").order("level").order("name");
    if (id_course) coursesQuery = coursesQuery.eq("id", id_course);
    else if (id_level) coursesQuery = coursesQuery.eq("level", id_level);

    const { data: coursesData, error: cErr } = await coursesQuery;
    if (cErr) return res.status(500).json({ error: cErr.message });
    const coursesList = coursesData || [];
    if (coursesList.length === 0) return res.json({ rows: [] });

    // 2) Determine classes scope (union of all levels from selected courses)
    const levelSet = [...new Set(coursesList.map((c) => c.level))];
    let classQuery = supabaseAdmin.from("class").select("id,name,level").order("name");
    if (levelSet.length === 1) classQuery = classQuery.eq("level", levelSet[0]);
    else classQuery = classQuery.in("level", levelSet);

    const courseIds = coursesList.map((c) => c.id);
    let ctQuery = supabaseAdmin.from("class_teacher").select("id_class,id_teacher,id_course");
    if (courseIds.length === 1) ctQuery = ctQuery.eq("id_course", courseIds[0]);
    else ctQuery = ctQuery.in("id_course", courseIds);

    const [{ data: classData, error: clsErr }, { data: ctData, error: ctErr }] =
      await Promise.all([classQuery, ctQuery]);

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (ctErr)  return res.status(500).json({ error: ctErr.message });

    // 3) Build key map: "id_class_id_course" -> id_teacher
    const ctMap = new Map();
    for (const r of ctData || []) ctMap.set(`${r.id_class}_${r.id_course}`, r.id_teacher);

    // 4) One row per (course × class) with matching level
    const rows = [];
    for (const course of coursesList) {
      for (const cls of classData || []) {
        if (cls.level !== course.level) continue;
        rows.push({
          id_class:    cls.id,
          class_name:  cls.name,
          id_teacher:  ctMap.get(`${cls.id}_${course.id}`) ?? null,
          id_course:   course.id,
          course_name: course.name,
        });
      }
    }

    return res.json({ rows });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo grid" });
  }
});

adminRouter.post("/save-assignment-grid", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.json({ ok: true });

    // Validar y normalizar
    const parsed = rows
      .map((r) => ({ id_class: toInt(r.id_class), id_course: toInt(r.id_course), id_teacher: cleanStr(r.id_teacher || "") }))
      .filter((r) => r.id_class && r.id_course);

    if (parsed.length === 0) return res.json({ ok: true });

    // Agrupar por id_course → 2 operaciones bulk por curso
    const byCourse = new Map();
    for (const r of parsed) {
      if (!byCourse.has(r.id_course)) byCourse.set(r.id_course, []);
      byCourse.get(r.id_course).push(r);
    }

    await Promise.all(
      [...byCourse.entries()].map(async ([id_course, courseRows]) => {
        const classIds = courseRows.map((r) => r.id_class);

        // 1 DELETE bulk para todas las clases cambiadas de este curso
        await supabaseAdmin
          .from("class_teacher")
          .delete()
          .eq("id_course", id_course)
          .in("id_class", classIds);

        // 1 INSERT bulk para las que tienen profesor asignado
        const toInsert = courseRows
          .filter((r) => r.id_teacher)
          .map((r) => ({ id_teacher: r.id_teacher, id_class: r.id_class, id_course }));

        if (toInsert.length > 0) {
          await supabaseAdmin.from("class_teacher").insert(toInsert);
        }
      })
    );

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error guardando asignaciones" });
  }
});