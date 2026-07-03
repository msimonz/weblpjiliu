import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";
import {
  getAnioLectivoVigente,
  invalidarCacheAnioLectivo,
  requireAnioVigenteForCourse,
  requireAnioVigenteForRecord,
  handleYearError,
} from "../lib/anioLectivo.js";
import { closeExpiredExams } from "../lib/examClosure.js";

export const adminRouter = Router();

// ===== Middleware: solo Admin =====
function requireAdmin(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("A")) return res.status(403).json({ error: "Solo Admin" });
  return next();
}

// ===== Middleware: Admin o Secretaría (solo lectura) =====
function requireAdminOrSecretary(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("A") && !roles.includes("E")) return res.status(403).json({ error: "Sin acceso" });
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
// Sincroniza course.id_monitor cuando se asigna o quita el rol M a un usuario.
// Si isMonitor=true: asigna userId como monitor del curso (desplaza al anterior si lo había).
// Si isMonitor=false: limpia course.id_monitor donde userId era el monitor.
async function syncMonitorCourse(userId, idCourse, isMonitor) {
  if (isMonitor) {
    // Quitar rol M al monitor anterior de este curso (si era otro)
    const { data: courseRow } = await supabaseAdmin
      .from("course")
      .select("id_monitor")
      .eq("id", idCourse)
      .maybeSingle();

    const prevMonitorId = courseRow?.id_monitor;
    if (prevMonitorId && prevMonitorId !== userId) {
      const { data: typeM } = await supabaseAdmin
        .from("type").select("id").eq("code", "M").maybeSingle();
      if (typeM?.id) {
        await supabaseAdmin
          .from("user_type")
          .delete()
          .eq("id_user", prevMonitorId)
          .eq("id_type", typeM.id);
      }
    }

    await supabaseAdmin
      .from("course")
      .update({ id_monitor: userId })
      .eq("id", idCourse);
  } else {
    // Limpiar course.id_monitor si este usuario era el monitor
    await supabaseAdmin
      .from("course")
      .update({ id_monitor: null })
      .eq("id_monitor", userId);
  }
}

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

// Devuelve todos los IDs de evaluation_type con un nombre dado (todos los años).
// Usar en operaciones de lectura que necesitan filtrar por tipo sin importar el año.
async function getEvaluationTypeIdsByName(typeName) {
  const { data } = await supabaseAdmin
    .from("evaluation_type")
    .select("id")
    .eq("type", typeName);
  return (data || []).map((r) => r.id);
}

// Para escrituras: busca o crea el tipo en el año especificado.
// year es obligatorio cuando se crea un nuevo tipo.
async function resolveEvaluationTypeId(id_type, type_text, year) {
  let typeId = Number(id_type || 0);
  if (typeId) return typeId;

  const raw = cleanStr(type_text);
  if (!raw) throw new Error("Selecciona un tipo o escribe type_text");

  // Buscar por (type, year)
  let q = supabaseAdmin.from("evaluation_type").select("id,type").eq("type", raw);
  if (year) q = q.eq("year", year);
  const { data: existing, error: exErr } = await q.maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing.id;

  // Crear con year
  const insertPayload = { type: raw };
  if (year) insertPayload.year = year;
  const { data: created, error: crErr } = await supabaseAdmin
    .from("evaluation_type")
    .insert(insertPayload)
    .select("id,type")
    .maybeSingle();

  if (crErr) throw new Error(crErr.message);
  return created.id;
}

// ============================================================================
// 0) LEVELS / MODULES / GROUPS
// ============================================================================
adminRouter.get("/levels", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { data, error } = await supabaseAdmin
    .from("level")
    .select("id,name,year")
    .eq("year", year)
    .order("id", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.get("/modules", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { data, error } = await supabaseAdmin
    .from("module")
    .select("id,name,year")
    .eq("year", year)
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

adminRouter.get("/groups", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { data, error } = await supabaseAdmin
    .from("group")
    .select("id,name,id_module,year")
    .eq("year", year)
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

// ============================================================================
// 1) COURSES
// ============================================================================
adminRouter.get("/courses", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const yearFilter = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { data, error } = await supabaseAdmin
    .from("course")
    .select("id,name,year,level,id_monitor")
    .eq("year", yearFilter)
    .order("level", { ascending: true })
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const courseIds = (data || []).map((c) => c.id);
  const { data: usedRows, error: usedErr } = courseIds.length > 0
    ? await supabaseAdmin
        .from("users")
        .select("id_course")
        .in("id_course", courseIds)
    : { data: [], error: null };

  if (usedErr) return res.status(500).json({ error: usedErr.message });

  // Cargar nombres de monitores asignados
  const monitorIds = [...new Set((data || []).map((c) => c.id_monitor).filter(Boolean))];
  let monitorMap = new Map();
  if (monitorIds.length > 0) {
    const { data: monitorRows } = await supabaseAdmin
      .from("users")
      .select("id,name")
      .in("id", monitorIds);
    monitorMap = new Map((monitorRows || []).map((u) => [u.id, u.name]));
  }

  const usedSet = new Set((usedRows || []).map((r) => String(r.id_course)));
  const items = (data || []).map((c) => ({
    id:           c.id,
    name:         c.name,
    year:         c.year,
    level:        c.level,
    user_count:   usedSet.has(String(c.id)) ? 1 : 0,
    id_monitor:   c.id_monitor   ?? null,
    monitor_name: monitorMap.get(c.id_monitor) ?? null,
  }));
  return res.json({ items });
});

adminRouter.delete("/courses/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "id inválido" });

  try { await requireAnioVigenteForRecord("course", id); }
  catch (err) { return handleYearError(res, err); }

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
  const vigente = await getAnioLectivoVigente();
  const year = toInt(req.body?.year) || vigente;

  if (!name) return res.status(400).json({ error: "name requerido" });
  if (!level) return res.status(400).json({ error: "level requerido" });
  if (year !== vigente) {
    return res.status(403).json({ error: `Solo se pueden crear cursos para el año lectivo vigente (${vigente})` });
  }

  const { data, error } = await supabaseAdmin
    .from("course")
    .insert({ name, level, year })
    .select("id,name,year,level")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

// ============================================================================
// T14 — GET /api/admin/courses/:id/students
// Estudiantes del curso (para dropdown Monitor en UI)
// ============================================================================
adminRouter.get("/courses/:id/students", requireAuth, requireAdmin, async (req, res) => {
  const courseId = toInt(req.params.id);
  if (!courseId) return res.status(400).json({ error: "id inválido" });

  try {
    const { data: typeRow } = await supabaseAdmin
      .from("type")
      .select("id")
      .eq("code", "S")
      .maybeSingle();

    if (!typeRow?.id) return res.status(500).json({ error: "Tipo S no encontrado" });

    const { data: users, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id,name,cedula")
      .eq("id_course", courseId)
      .order("name", { ascending: true });

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!users?.length) return res.json({ items: [] });

    const { data: roleRows, error: rErr } = await supabaseAdmin
      .from("user_type")
      .select("id_user")
      .eq("id_type", typeRow.id)
      .in("id_user", users.map((u) => u.id));

    if (rErr) return res.status(500).json({ error: rErr.message });

    const studentSet = new Set((roleRows || []).map((r) => r.id_user));
    return res.json({ items: users.filter((u) => studentSet.has(u.id)) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// T15 — PUT /api/admin/courses/:id/monitor
// Asignar o desasignar monitor de un curso
// Body: { id_monitor: uuid | null }
// ============================================================================
adminRouter.put("/courses/:id/monitor", requireAuth, requireAdmin, async (req, res) => {
  const courseId = toInt(req.params.id);
  if (!courseId) return res.status(400).json({ error: "id inválido" });

  const id_monitor = req.body?.id_monitor ?? null;

  try {
    // Validar que el curso exista y sea del año vigente
    try { await requireAnioVigenteForRecord("course", courseId); }
    catch (err) { return handleYearError(res, err); }

    if (id_monitor !== null) {
      // Verificar que el usuario existe y pertenece al curso
      const { data: userRow, error: uErr } = await supabaseAdmin
        .from("users")
        .select("id,id_course")
        .eq("id", id_monitor)
        .maybeSingle();

      if (uErr) return res.status(500).json({ error: uErr.message });
      if (!userRow) return res.status(404).json({ error: "Usuario no encontrado" });
      if (Number(userRow.id_course) !== courseId) {
        return res.status(400).json({ error: "El usuario no pertenece a este curso" });
      }

      // Verificar que no sea ya monitor de otro curso en el mismo año
      const { data: courseRow } = await supabaseAdmin
        .from("course")
        .select("year")
        .eq("id", courseId)
        .maybeSingle();

      const { data: otherMonitor } = await supabaseAdmin
        .from("course")
        .select("id")
        .eq("id_monitor", id_monitor)
        .eq("year", courseRow.year)
        .neq("id", courseId)
        .maybeSingle();

      if (otherMonitor) {
        return res.status(409).json({ error: "Este estudiante ya es monitor de otro curso en el mismo año lectivo" });
      }

      // Asignar rol M si no lo tiene
      const { data: typeM } = await supabaseAdmin
        .from("type").select("id").eq("code", "M").maybeSingle();

      if (typeM?.id) {
        await supabaseAdmin
          .from("user_type")
          .upsert({ id_user: id_monitor, id_type: typeM.id }, { onConflict: "id_user,id_type" });
      }
    }

    // Si se desasigna monitor (id_monitor = null), quitar rol M del monitor anterior
    if (id_monitor === null) {
      const { data: currentCourse } = await supabaseAdmin
        .from("course")
        .select("id_monitor")
        .eq("id", courseId)
        .maybeSingle();

      if (currentCourse?.id_monitor) {
        const { data: typeM } = await supabaseAdmin
          .from("type").select("id").eq("code", "M").maybeSingle();

        if (typeM?.id) {
          await supabaseAdmin
            .from("user_type")
            .delete()
            .eq("id_user", currentCourse.id_monitor)
            .eq("id_type", typeM.id);
        }
      }
    }

    // Actualizar course.id_monitor
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("course")
      .update({ id_monitor })
      .eq("id", courseId)
      .select("id,name,id_monitor")
      .maybeSingle();

    if (upErr) return res.status(500).json({ error: upErr.message });
    return res.json({ ok: true, item: updated });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 2) CLASSES
// ============================================================================
adminRouter.get("/classes", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const [
    { data: classData, error: classErr },
    { data: grpData,   error: grpErr },
  ] = await Promise.all([
    supabaseAdmin
      .from("class")
      .select("id,name,level,id_module,id_group,year,created_at,module:module(id,name)")
      .eq("year", year)
      .order("level", { ascending: true })
      .order("name",  { ascending: true }),
    supabaseAdmin
      .from("group")
      .select("id,name")
      .eq("year", year),
  ]);

  if (classErr) return res.status(500).json({ error: classErr.message });
  if (grpErr)   return res.status(500).json({ error: grpErr.message });

  const grpMap = new Map((grpData || []).map((g) => [g.id, g.name]));

  const items = (classData || []).map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    id_module: c.id_module,
    module_name: c.module?.name || null,
    created_at: c.created_at,
    groups: c.id_group ? [{ id: c.id_group, name: grpMap.get(c.id_group) || "" }] : [],
  }));

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

    const vigente = await getAnioLectivoVigente();

    if (!id_module && new_module_name) {
      const mod = await getOrCreateModuleByName(new_module_name, vigente);
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
      const grp = await getOrCreateGroupByName(new_group_name, vigente);
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
        year: vigente,
        ...(id_group ? { id_group } : {}),
      })
      .select("id,name,level,id_module,id_group,year,created_at")
      .maybeSingle();

    if (classErr) return res.status(500).json({ error: classErr.message });

    return res.json({ item: createdClass });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando materia" });
  }
});

// ============================================================================
// 3) EVALUATION TYPES
// ============================================================================
adminRouter.get("/evaluation-types", requireAuth, requireAdmin, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());

  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type,year,created_at")
    .eq("year", year)
    .order("id", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const typeIds = (data || []).map((t) => t.id);
  let usedSet = new Set();
  if (typeIds.length > 0) {
    const { data: usedRows, error: usedErr } = await supabaseAdmin
      .from("evaluation")
      .select("id_type")
      .in("id_type", typeIds);
    if (usedErr) return res.status(500).json({ error: usedErr.message });
    usedSet = new Set((usedRows || []).map((r) => String(r.id_type)));
  }

  const items = (data || []).map((t) => ({ ...t, eval_count: usedSet.has(String(t.id)) ? 1 : 0 }));
  return res.json({ items });
});

adminRouter.delete("/evaluation-types/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "id inválido" });

  try { await requireAnioVigenteForRecord("evaluation_type", id); }
  catch (err) { return handleYearError(res, err); }

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

  const vigente = await getAnioLectivoVigente();

  const { data: ex, error: exErr } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type,year")
    .eq("type", type)
    .eq("year", vigente)
    .maybeSingle();

  if (exErr) return res.status(500).json({ error: exErr.message });
  if (ex?.id) return res.json({ item: ex });

  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .insert({ type, year: vigente })
    .select("id,type,year,created_at")
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
  const id_class   = toInt(req.body?.id_class);
  const id_course  = toInt(req.body?.id_course);

  if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
  if (!id_class)   return res.status(400).json({ error: "id_class requerido" });
  if (!id_course)  return res.status(400).json({ error: "id_course requerido" });

  try { await requireAnioVigenteForCourse(id_course); }
  catch (err) { return handleYearError(res, err); }

  const { data, error } = await supabaseAdmin
    .from("class_teacher")
    .upsert({ id_teacher, id_class, id_course }, { onConflict: "id_teacher,id_class,id_course" })
    .select("id_teacher,id_class,id_course,created_at")
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
  res.set("Cache-Control", "no-store");
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

adminRouter.get("/class-grade-grid", requireAuth, requireAdminOrSecretary, async (req, res) => {
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
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
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

adminRouter.get("/group-grade-grid", requireAuth, requireAdminOrSecretary, async (req, res) => {
  try {
    const groupId = Number(req.query.group_id);
    const courseId = toInt(req.query.course_id);
    if (!groupId) return res.status(400).json({ error: "group_id requerido" });

    let evQuery = supabaseAdmin
      .from("evaluation")
      .select(`id,title,percent,created_at,id_course,id_class,id_group,id_module,id_type,
        course:course(id,name,level,year),
        class:class(id,name,level),
        evaluation_type:evaluation_type(id,type),
        module:module(id,name),
        group:group(id,name)`)
      .eq("id_group", groupId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (courseId) evQuery = evQuery.eq("id_course", courseId);

    const { data: evRows, error: evErr } = await evQuery;

    if (evErr) return res.status(500).json({ error: evErr.message });
    const evals = evRows || [];

    const group = evals[0]?.group ?? { id: groupId, name: `Grupo ${groupId}` };
    const courseIds = [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];
    const studentsRaw = courseIds.length > 0 ? await getStudentsByCourseIds(courseIds) : [];

    let courseNameMap = new Map();
    if (courseIds.length > 0) {
      const { data: cRows } = await supabaseAdmin.from("course").select("id,name").in("id", courseIds);
      courseNameMap = new Map((cRows || []).map((c) => [Number(c.id), c.name]));
    }

    const students = (studentsRaw || []).map((u) => ({
      id: u.id, name: u.name, cedula: u.cedula,
      id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    const examIds = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);
    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,finished_at,attempts")
        .in("id_exam", examIds)
        .in("id_student", studentIds);
      if (gErr) return res.status(500).json({ error: gErr.message });
      grades = gRows || [];
    }

    return res.json({ class: null, group, evaluations: evals, students, grades });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error cargando grilla de grupo" });
  }
});

// Flexible grade grid: all params optional
// level=0 or omit = all levels; course_id omit = all courses; module_id omit = all modules; class_id omit = all classes
adminRouter.get("/grade-grid", requireAuth, requireAdminOrSecretary, async (req, res) => {
  try {
    const classId  = toInt(req.query.class_id);
    const courseId = toInt(req.query.course_id);
    const moduleId = toInt(req.query.module_id);
    const level    = toInt(req.query.level); // 0 or omit = all levels

    // 1. Resolve which classes/modules to include
    let classQuery = supabaseAdmin.from("class").select("id,name,level,id_module");
    if (classId) {
      classQuery = classQuery.eq("id", classId);
    } else {
      if (level && level > 0) classQuery = classQuery.eq("level", level);
      if (moduleId)           classQuery = classQuery.eq("id_module", moduleId);
    }
    classQuery = classQuery.order("level").order("name");

    const { data: classRows, error: clsErr } = await classQuery;
    if (clsErr) return res.status(500).json({ error: clsErr.message });
    const classIds = (classRows || []).map((c) => c.id);
    if (classIds.length === 0)
      return res.json({ classes: [], evaluations: [], students: [], grades: [] });

    const includeGroupEvaluations = !classId;
    const moduleIds = includeGroupEvaluations
      ? [...new Set((classRows || []).map((c) => Number(c.id_module)).filter(Boolean))]
      : [];

    // 2. Get evaluations for those classes plus grouped evaluations in the same scope
    let classEvQuery = supabaseAdmin
      .from("evaluation")
      .select(`id,title,percent,created_at,id_course,id_class,id_group,id_module,id_type,id_teacher,
        course:course(id,name,level,year),
        class:class(id,name,level),
        module:module(id,name),
        group:group(id,name),
        evaluation_type:evaluation_type(id,type)`)
      .in("id_class", classIds)
      .order("id_class", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (courseId) classEvQuery = classEvQuery.eq("id_course", courseId);

    let groupEvQuery = supabaseAdmin
      .from("evaluation")
      .select(`id,title,percent,created_at,id_course,id_class,id_group,id_module,id_type,id_teacher,
        course:course(id,name,level,year),
        class:class(id,name,level),
        module:module(id,name),
        group:group(id,name),
        evaluation_type:evaluation_type(id,type)`)
      .in("id_module", moduleIds)
      .not("id_group", "is", null)
      .order("id_group", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (courseId) groupEvQuery = groupEvQuery.eq("id_course", courseId);

    const [
      { data: classEvaluations, error: classEvErr },
      { data: groupEvaluations, error: groupEvErr },
    ] = await Promise.all([classEvQuery, moduleIds.length ? groupEvQuery : Promise.resolve({ data: [], error: null })]);

    if (classEvErr) return res.status(500).json({ error: classEvErr.message });
    if (groupEvErr) return res.status(500).json({ error: groupEvErr.message });

    const evals = [...(classEvaluations || []), ...(groupEvaluations || [])];

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
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
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

    await closeExpiredExams({ evaluationIds: [examId] });

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
    if (cls.id_group) return res.status(400).json({
      error: "Esta materia pertenece a un grupo de evaluación. Las evaluaciones deben crearse a nivel de grupo.",
    });

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

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const typeId = await resolveEvaluationTypeId(id_type, type_text, course.year);

    const { data, error } = await supabaseAdmin
      .from("evaluation")
      .insert({
        id_course,
        id_teacher,
        id_type: typeId,
        percent,
        title,
        id_module: cls.id_module || null,
        id_class,
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
    const stId = cleanStr(req.body?.student_id);
    const grade = Number(req.body?.grade);

    if (!examId) return res.status(400).json({ error: "exam_id requerido" });
    if (!ced && !stId) return res.status(400).json({ error: "student_cedula o student_id requerido" });
    if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
      return res.status(400).json({ error: "grade inválida (0..100)" });
    }

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id,id_course,evaluation_type:evaluation_type(type)")
      .eq("id", examId)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    let stQuery = supabaseAdmin.from("users").select("id,cedula,name,email,id_course");
    if (ced) {
      stQuery = stQuery.eq("cedula", ced);
    } else {
      stQuery = stQuery.eq("id", stId);
    }
    const { data: st, error: stErr } = await stQuery.maybeSingle();

    if (stErr) return res.status(500).json({ error: stErr.message });
    if (!st?.id) return res.status(404).json({ error: ced ? "No existe estudiante con esa cédula" : "No existe estudiante con ese id" });

    if (Number(st.id_course) !== Number(ev.id_course)) {
      return res.status(400).json({ error: "El estudiante no pertenece al curso de esta evaluación" });
    }

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { data: existingGrade, error: existingGradeErr } = await supabaseAdmin
      .from("grades")
      .select("attempts")
      .eq("id_exam", examId)
      .eq("id_student", st.id)
      .maybeSingle();

    if (existingGradeErr) return res.status(500).json({ error: existingGradeErr.message });

    const payload = {
      id_exam: examId,
      id_student: st.id,
      grade,
      finished_at: new Date().toISOString(),
      attempts: Number(existingGrade?.attempts ?? 0) + 1,
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

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

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
      .select("id,id_course")
      .eq("id", id)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

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

// POST /api/admin/evaluations/bulk — crear evaluación de grupo
adminRouter.post("/evaluations/bulk", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_group  = toInt(req.body?.id_group);
    const id_course = toInt(req.body?.id_course);
    const id_teacher = cleanStr(req.body?.id_teacher);
    const percent = Number(req.body?.percent);
    const title = cleanStr(req.body?.title);
    const id_type = toInt(req.body?.id_type);
    const type_text = cleanStr(req.body?.type_text);

    if (!id_group)   return res.status(400).json({ error: "id_group requerido" });
    if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return res.status(400).json({ error: "percent inválido (1..100)" });
    }
    if (!title) return res.status(400).json({ error: "title requerido" });

    if (id_course) {
      try { await requireAnioVigenteForCourse(id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    const { data: grp, error: grpErr } = await supabaseAdmin
      .from("group")
      .select("id,id_module")
      .eq("id", id_group)
      .maybeSingle();

    if (grpErr) return res.status(500).json({ error: grpErr.message });
    if (!grp?.id) return res.status(404).json({ error: "Grupo no existe" });

    const vigente = await getAnioLectivoVigente();
    const typeId = await resolveEvaluationTypeId(id_type, type_text, vigente);

    const row = {
      id_course: id_course || null,
      id_teacher,
      id_type: typeId,
      percent,
      title,
      id_group,
      id_module: grp.id_module,
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

    // Validación columna D (type) — celda por celda para evitar bug de exceljs@3.4.0 con rangos
    const typeValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`_listas!$A$1:$A$${typeRows}`],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Tipo inválido",
      error: "Selecciona un tipo de la lista desplegable",
    };
    for (let row = 2; row <= 200; row++) {
      ws.dataValidations.add(`D${row}`, typeValidation);
    }

    // Validación columna F (curso)
    if (courseRows > 0) {
      const courseValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`_listas!$B$1:$B$${courseRows}`],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Curso inválido",
        error: "Selecciona un curso de la lista desplegable",
      };
      for (let row = 2; row <= 200; row++) {
        ws.dataValidations.add(`F${row}`, courseValidation);
      }
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
          .select("id, year")
          .eq("name", courseNameRaw)
          .maybeSingle();
        if (courseMatch) {
          id_course = courseMatch.id;
        } else {
          const asInt = toInt(courseNameRaw);
          if (asInt) {
            const { data: courseById } = await supabaseAdmin
              .from("course")
              .select("id, year")
              .eq("id", asInt)
              .maybeSingle();
            if (courseById) id_course = courseById.id;
          }
        }
        // Solo se puede asignar a cursos del año lectivo vigente
        if (id_course) {
          try { await requireAnioVigenteForCourse(id_course); }
          catch {
            results.errors.push({ row: rowNum, error: `El curso '${courseNameRaw}' no pertenece al año lectivo vigente` });
            results.skipped++;
            continue;
          }
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
adminRouter.get("/users/search", requireAuth, requireAdmin, async (req, res) => {
  try {
    const q = cleanStr(req.query?.q || "");
    if (!q) return res.status(400).json({ error: "q requerido" });

    const pattern = `%${q}%`;

    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, name, email, cedula, code_jiliu, id_course, course:course!users_id_course_fkey(id, name)")
      .or(`cedula.ilike.${pattern},name.ilike.${pattern},email.ilike.${pattern},code_jiliu.ilike.${pattern}`)
      .limit(30);

    if (error) return res.status(500).json({ error: error.message });

    const items = await Promise.all((data || []).map(async (u) => {
      const { data: ut } = await supabaseAdmin
        .from("user_type")
        .select("type(code)")
        .eq("id_user", u.id);
      const roles = (ut || []).map((r) => r.type?.code).filter(Boolean);
      const { course, ...rest } = u;
      return { ...rest, roles, course_name: course?.name || null };
    }));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error buscando personas" });
  }
});

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

    // Verificar que el email no esté ya registrado
    const { data: emailExists } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (emailExists?.id) {
      return res.status(409).json({ error: `El email '${email}' ya está registrado en el sistema.` });
    }

    if (roles.length === 0 || roles.some((r) => !["S", "T", "A", "M", "E"].includes(String(r).toUpperCase()))) {
      return res.status(400).json({ error: "roles inválidos (S/T/A/M)" });
    }
    const roleList = roles.map((r) => String(r).toUpperCase());

    if (roleList.includes("M") && !roleList.includes("S")) {
      return res.status(400).json({ error: "Un monitor debe tener también el rol Estudiante" });
    }

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

    await syncMonitorCourse(authUserId, id_course, roleList.includes("M"));

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

    if (roles.length === 0 || roles.some((r) => !["S", "T", "A", "M", "E"].includes(String(r).toUpperCase()))) {
      return res.status(400).json({ error: "roles inválidos (S/T/A/M)" });
    }

    const roleList = roles.map((r) => String(r).toUpperCase());

    if (roleList.includes("M") && !roleList.includes("S")) {
      return res.status(400).json({ error: "Un monitor debe tener también el rol Estudiante" });
    }

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

    await syncMonitorCourse(userId, id_course, roleList.includes("M"));

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

async function getOrCreateModuleByName(name, year) {
  const cleanName = cleanStr(name);
  if (!cleanName) throw new Error("Nombre de módulo requerido");
  if (!year) throw new Error("year requerido en getOrCreateModuleByName");

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("module")
    .select("id,name")
    .ilike("name", cleanName)
    .eq("year", year)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing;

  const { data: created, error: crErr } = await supabaseAdmin
    .from("module")
    .insert({ name: cleanName, year })
    .select("id,name")
    .maybeSingle();

  if (crErr) throw new Error(crErr.message);
  return created;
}

async function getOrCreateGroupByName(name, year) {
  const cleanName = cleanStr(name);
  if (!cleanName) throw new Error("Nombre de grupo requerido");
  if (!year) throw new Error("year requerido en getOrCreateGroupByName");

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("group")
    .select("id,name")
    .ilike("name", cleanName)
    .eq("year", year)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing;

  const { data: created, error: crErr } = await supabaseAdmin
    .from("group")
    .insert({ name: cleanName, year })
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
    const id_class   = toInt(req.body?.id_class);
    const id_course  = toInt(req.body?.id_course);

    if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
    if (!id_class)   return res.status(400).json({ error: "id_class requerido" });
    if (!id_course)  return res.status(400).json({ error: "id_course requerido" });

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    let q = supabaseAdmin
      .from("class_teacher")
      .delete()
      .eq("id_teacher", id_teacher)
      .eq("id_class", id_class)
      .eq("id_course", id_course);

    const { error } = await q;

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
    let classQuery = supabaseAdmin.from("class").select("id,name,level,id_module,id_group").order("name");
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

    // 3) Build module and group maps
    const moduleIds = [...new Set((classData || []).map((c) => c.id_module).filter(Boolean))];
    const moduleMap = new Map();
    if (moduleIds.length > 0) {
      const { data: modData } = await supabaseAdmin.from("module").select("id,name").in("id", moduleIds);
      for (const m of modData || []) moduleMap.set(m.id, m.name);
    }

    const groupIds = [...new Set((classData || []).map((c) => c.id_group).filter(Boolean))];
    const groupMap = new Map();
    if (groupIds.length > 0) {
      const { data: grpData } = await supabaseAdmin.from("group").select("id,name").in("id", groupIds);
      for (const g of grpData || []) groupMap.set(g.id, g.name);
    }

    // 4) Build key map: "id_class_id_course" -> id_teacher
    const ctMap = new Map();
    for (const r of ctData || []) ctMap.set(`${r.id_class}_${r.id_course}`, r.id_teacher);

    // 5) One row per (course × class) with matching level
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
          id_module:   cls.id_module ?? null,
          module_name: cls.id_module ? (moduleMap.get(cls.id_module) ?? null) : null,
          id_group:    cls.id_group ?? null,
          group_name:  cls.id_group ? (groupMap.get(cls.id_group) ?? null) : null,
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

// ============================================================================
// TAREA 6 — POST /api/admin/exams
// Crea examen maestro en evaluation + preguntas en examen_detalle
// ============================================================================
adminRouter.post("/exams", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_course      = toInt(req.body?.id_course);
    const id_class       = toInt(req.body?.id_class);
    const id_group       = toInt(req.body?.id_group);
    const id_teacher     = cleanStr(req.body?.id_teacher);
    const title          = cleanStr(req.body?.title);
    const percent        = Number(req.body?.percent);
    const tiempo_minutos = toInt(req.body?.tiempo_minutos);
    const preguntas      = req.body?.preguntas;

    if (!id_course) return res.status(400).json({ error: "id_course requerido" });
    if (!id_class && !id_group) return res.status(400).json({ error: "id_class o id_group requerido" });
    if (!title)     return res.status(400).json({ error: "title requerido" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
      return res.status(400).json({ error: "percent inválido (1..100)" });
    if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
    if (!tiempo_minutos || tiempo_minutos < 1)
      return res.status(400).json({ error: "tiempo_minutos requerido (mínimo 1)" });
    if (!Array.isArray(preguntas))
      return res.status(400).json({ error: "preguntas debe ser un array" });

    if (preguntas.length < 1)
      return res.status(400).json({ error: "El examen debe tener al menos 1 pregunta" });

    // Validar tipos permitidos
    const TIPOS_VALIDOS = ["multiple_multi", "multiple_single", "falso_verdadero", "emparejamiento"];
    for (let i = 0; i < preguntas.length; i++) {
      const p = preguntas[i];
      if (!TIPOS_VALIDOS.includes(p?.tipo))
        return res.status(400).json({ error: `Pregunta ${i + 1}: tipo inválido ('${p?.tipo}')` });
      if (!cleanStr(p?.enunciado))
        return res.status(400).json({ error: `Pregunta ${i + 1}: enunciado requerido` });
      const pts = Number(p?.puntos);
      if (!Number.isFinite(pts) || pts <= 0)
        return res.status(400).json({ error: `Pregunta ${i + 1}: puntos inválidos` });
      if (!p?.opciones)
        return res.status(400).json({ error: `Pregunta ${i + 1}: opciones requeridas` });
      if (!p?.respuesta_correcta)
        return res.status(400).json({ error: `Pregunta ${i + 1}: respuesta_correcta requerida` });

      const rc = p.respuesta_correcta;
      const rcVacia =
        (Array.isArray(rc) && rc.length === 0) ||
        (typeof rc === "object" && !Array.isArray(rc) && Object.keys(rc).length === 0);
      if (rcVacia)
        return res.status(400).json({ error: `Pregunta ${i + 1}: debe tener al menos una respuesta correcta` });
    }

    // Validar suma de puntos = 100
    const sumaPuntos = preguntas.reduce((acc, p) => acc + Number(p.puntos), 0);
    if (Math.abs(sumaPuntos - 100) > 0.01)
      return res.status(400).json({ error: `La suma de puntos debe ser 100 (actual: ${sumaPuntos})` });

    // Resolver scope: por materia o por grupo
    let id_module_resolved = null;
    let id_class_resolved  = null;
    let id_group_resolved  = null;
    let courseYear         = null;

    if (id_class) {
      const { data: cls, error: clsErr } = await supabaseAdmin
        .from("class")
        .select("id,name,level,id_module,id_group")
        .eq("id", id_class)
        .maybeSingle();
      if (clsErr) return res.status(500).json({ error: clsErr.message });
      if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });
      if (cls.id_group) return res.status(400).json({
        error: "Esta materia pertenece a un grupo de evaluación. Los exámenes deben crearse a nivel de grupo.",
      });

      const { data: course, error: cErr } = await supabaseAdmin
        .from("course")
        .select("id,name,level,year")
        .eq("id", id_course)
        .maybeSingle();
      if (cErr) return res.status(500).json({ error: cErr.message });
      if (!course?.id) return res.status(404).json({ error: "Curso no existe" });
      if (Number(course.level) !== Number(cls.level))
        return res.status(400).json({ error: "El curso no corresponde al nivel de la materia" });

      id_class_resolved  = id_class;
      id_module_resolved = cls.id_module || null;
      courseYear         = course.year;
    } else {
      const { data: grp, error: grpErr } = await supabaseAdmin
        .from("group")
        .select("id,id_module")
        .eq("id", id_group)
        .maybeSingle();
      if (grpErr) return res.status(500).json({ error: grpErr.message });
      if (!grp?.id) return res.status(404).json({ error: "Grupo no existe" });

      const { data: course, error: cErr } = await supabaseAdmin
        .from("course")
        .select("id,name,level,year")
        .eq("id", id_course)
        .maybeSingle();
      if (cErr) return res.status(500).json({ error: cErr.message });
      if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

      id_group_resolved  = id_group;
      id_module_resolved = grp.id_module || null;
      courseYear         = course.year;
    }

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const examenTypeId = await resolveEvaluationTypeId(null, "Examen", courseYear);

    const { data: evalData, error: evalErr } = await supabaseAdmin
      .from("evaluation")
      .insert({
        id_course,
        id_class:  id_class_resolved,
        id_group:  id_group_resolved,
        id_teacher,
        id_type: examenTypeId,
        percent,
        title,
        id_module: id_module_resolved,
        tiempo_minutos,
      })
      .select("id,title,percent,tiempo_minutos,created_at")
      .maybeSingle();

    if (evalErr) return res.status(500).json({ error: evalErr.message });

    // Insertar preguntas en examen_detalle
    const detalleRows = preguntas.map((p, idx) => ({
      id_evaluation:     evalData.id,
      orden:             idx + 1,
      tipo:              p.tipo,
      enunciado:         cleanStr(p.enunciado),
      puntos:            Number(p.puntos),
      opciones:          p.opciones,
      respuesta_correcta: p.respuesta_correcta,
    }));

    const { error: detErr } = await supabaseAdmin
      .from("examen_detalle")
      .insert(detalleRows);

    if (detErr) {
      // Rollback: eliminar el evaluation recién creado
      await supabaseAdmin.from("evaluation").delete().eq("id", evalData.id);
      return res.status(500).json({ error: `Error guardando preguntas: ${detErr.message}` });
    }

    return res.status(201).json({ ok: true, item: evalData });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando examen" });
  }
});

// ============================================================================
// TAREA 7 — GET /api/admin/exams
// Lista evaluaciones de tipo Examen con sus preguntas
// Query params opcionales: id_course, id_class, id_module, id_group
// ============================================================================
adminRouter.get("/exams", requireAuth, requireAdmin, async (req, res) => {
  try {
    const examenTypeIds = await getEvaluationTypeIdsByName("Examen");
    if (!examenTypeIds.length) return res.json({ items: [] });

    let q = supabaseAdmin
      .from("evaluation")
      .select(`
        id, title, percent, tiempo_minutos, created_at, id_teacher,
        id_course, id_class, id_module, id_group,
        course:course(id,name,year,level),
        class:class(id,name,level,id_module),
        module:module(id,name),
        group:group(id,name),
        teacher:users!id_teacher(id,name)
      `)
      .in("id_type", examenTypeIds)
      .order("created_at", { ascending: false });

    if (req.query.id_course) q = q.eq("id_course", toInt(req.query.id_course));
    if (req.query.id_class)  q = q.eq("id_class",  toInt(req.query.id_class));
    if (req.query.id_module) q = q.eq("id_module", toInt(req.query.id_module));
    if (req.query.id_group)  q = q.eq("id_group",  toInt(req.query.id_group));

    const { data: evals, error: evErr } = await q;
    if (evErr) return res.status(500).json({ error: evErr.message });

    if (!evals?.length) return res.json({ items: [] });

    // Traer preguntas (sin respuesta_correcta para listado — solo metadatos)
    const evalIds = evals.map((e) => e.id);
    const { data: detalle, error: detErr } = await supabaseAdmin
      .from("examen_detalle")
      .select("id, id_evaluation, orden, tipo, enunciado, puntos, opciones, respuesta_correcta")
      .in("id_evaluation", evalIds)
      .order("id_evaluation")
      .order("orden");

    if (detErr) return res.status(500).json({ error: detErr.message });

    const detalleMap = new Map();
    for (const d of detalle || []) {
      if (!detalleMap.has(d.id_evaluation)) detalleMap.set(d.id_evaluation, []);
      detalleMap.get(d.id_evaluation).push(d);
    }

    const items = evals.map((e) => ({
      ...e,
      preguntas: detalleMap.get(e.id) || [],
    }));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error listando exámenes" });
  }
});

// ============================================================================
// TAREA 8 — DELETE /api/admin/exams/:id
// Elimina examen maestro (cascade elimina examen_detalle y examen_programacion)
// ============================================================================
adminRouter.delete("/exams/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const examenTypeIds = await getEvaluationTypeIdsByName("Examen");
    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id, id_type, id_course")
      .eq("id", id)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (!examenTypeIds.includes(ev.id_type))
      return res.status(400).json({ error: "Esta evaluación no es de tipo Examen" });

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    const { error } = await supabaseAdmin.from("evaluation").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error eliminando examen" });
  }
});

// ============================================================================
// GET /api/admin/exams/:id
// Devuelve un examen con sus preguntas (incluye respuesta_correcta)
// ============================================================================
adminRouter.get("/exams/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const examenTypeIds = await getEvaluationTypeIdsByName("Examen");
    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select(`
        id, title, percent, tiempo_minutos, created_at, id_teacher,
        id_course, id_class, id_module, id_group,
        course:course(id,name,year,level),
        class:class(id,name,level),
        module:module(id,name),
        group:group(id,name),
        teacher:users!id_teacher(id,name)
      `)
      .eq("id", id)
      .in("id_type", examenTypeIds)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });

    const { data: preguntas, error: detErr } = await supabaseAdmin
      .from("examen_detalle")
      .select("id, orden, tipo, enunciado, puntos, opciones, respuesta_correcta")
      .eq("id_evaluation", id)
      .order("orden");

    if (detErr) return res.status(500).json({ error: detErr.message });

    return res.json({ item: { ...ev, preguntas: preguntas || [] } });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error cargando examen" });
  }
});

// ============================================================================
// PUT /api/admin/exams/:id
// Reemplaza tiempo_minutos y preguntas de un examen existente
// ============================================================================
adminRouter.put("/exams/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const tiempo_minutos = toInt(req.body?.tiempo_minutos);
    const percent        = Number(req.body?.percent);
    const id_teacher     = cleanStr(req.body?.id_teacher);
    const title          = cleanStr(req.body?.title);
    const preguntas      = req.body?.preguntas;

    if (!id_teacher) return res.status(400).json({ error: "id_teacher requerido" });
    if (!title) return res.status(400).json({ error: "title requerido" });
    if (!tiempo_minutos || tiempo_minutos < 1)
      return res.status(400).json({ error: "tiempo_minutos requerido (mínimo 1)" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
      return res.status(400).json({ error: "percent inválido (1..100)" });
    if (!Array.isArray(preguntas))
      return res.status(400).json({ error: "preguntas debe ser un array" });
    if (preguntas.length < 1)
      return res.status(400).json({ error: "El examen debe tener al menos 1 pregunta" });

    const TIPOS_VALIDOS = ["multiple_multi", "multiple_single", "falso_verdadero", "emparejamiento"];
    for (let i = 0; i < preguntas.length; i++) {
      const p = preguntas[i];
      if (!TIPOS_VALIDOS.includes(p?.tipo))
        return res.status(400).json({ error: `Pregunta ${i + 1}: tipo inválido` });
      if (!cleanStr(p?.enunciado))
        return res.status(400).json({ error: `Pregunta ${i + 1}: enunciado requerido` });
      const pts = Number(p?.puntos);
      if (!Number.isFinite(pts) || pts <= 0)
        return res.status(400).json({ error: `Pregunta ${i + 1}: puntos inválidos` });
      if (!p?.opciones)
        return res.status(400).json({ error: `Pregunta ${i + 1}: opciones requeridas` });
      if (!p?.respuesta_correcta)
        return res.status(400).json({ error: `Pregunta ${i + 1}: respuesta_correcta requerida` });
      const rc = p.respuesta_correcta;
      const rcVacia =
        (Array.isArray(rc) && rc.length === 0) ||
        (typeof rc === "object" && !Array.isArray(rc) && Object.keys(rc).length === 0);
      if (rcVacia)
        return res.status(400).json({ error: `Pregunta ${i + 1}: debe tener al menos una respuesta correcta` });
    }

    const sumaPuntos = preguntas.reduce((acc, p) => acc + Number(p.puntos), 0);
    if (Math.abs(sumaPuntos - 100) > 0.01)
      return res.status(400).json({ error: `La suma de puntos debe ser 100 (actual: ${sumaPuntos})` });

    // Verificar que sea tipo Examen y que pertenezca al año vigente
    const examenTypeIds = await getEvaluationTypeIdsByName("Examen");
    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id, id_type, id_course")
      .eq("id", id)
      .maybeSingle();
    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (!examenTypeIds.includes(ev.id_type))
      return res.status(400).json({ error: "Esta evaluación no es de tipo Examen" });

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    // Actualizar datos del examen en evaluation, incluyendo el profesor asignado
    const { error: updErr } = await supabaseAdmin
      .from("evaluation")
      .update({ tiempo_minutos, percent, id_teacher, title })
      .eq("id", id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    // Reemplazar preguntas: delete + insert
    const { error: delErr } = await supabaseAdmin
      .from("examen_detalle")
      .delete()
      .eq("id_evaluation", id);
    if (delErr) return res.status(500).json({ error: delErr.message });

    const detalleRows = preguntas.map((p, idx) => ({
      id_evaluation:      id,
      orden:              idx + 1,
      tipo:               p.tipo,
      enunciado:          cleanStr(p.enunciado),
      puntos:             Number(p.puntos),
      opciones:           p.opciones,
      respuesta_correcta: p.respuesta_correcta,
    }));

    const { error: insErr } = await supabaseAdmin
      .from("examen_detalle")
      .insert(detalleRows);
    if (insErr) return res.status(500).json({ error: `Error actualizando preguntas: ${insErr.message}` });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando examen" });
  }
});

// ============================================================================
// TAREA 9 — GET /api/admin/exam-schedules
// Lista todas las programaciones con joins a evaluation y course
// ============================================================================
adminRouter.get("/exam-schedules", requireAuth, requireAdmin, async (req, res) => {
  try {
    let q = supabaseAdmin
      .from("examen_programacion")
      .select(`
        id, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado, created_at,
        id_evaluation, id_course,
        evaluation:evaluation(
          id, title, percent, tiempo_minutos,
          id_module, id_group, id_class,
          module:module(id,name),
          group:group(id,name),
          class:class(id,name)
        ),
        course:course(id,name,year,level)
      `)
      .order("created_at", { ascending: false });

    if (req.query.id_evaluation) q = q.eq("id_evaluation", toInt(req.query.id_evaluation));
    if (req.query.id_course)     q = q.eq("id_course",     toInt(req.query.id_course));
    if (req.query.habilitado !== undefined)
      q = q.eq("habilitado", req.query.habilitado === "true");

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error listando programaciones" });
  }
});

// ============================================================================
// TAREA 10 — POST /api/admin/exam-schedules
// Crea una nueva programación (habilita examen para curso + año + fechas)
// ============================================================================
adminRouter.post("/exam-schedules", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_evaluation = toInt(req.body?.id_evaluation);
    const id_course     = toInt(req.body?.id_course);
    const year          = toInt(req.body?.year);
    const fecha_ini     = req.body?.fecha_ini || null;
    const fecha_fin     = req.body?.fecha_fin || null;
    const fecha_limite_ver = req.body?.fecha_limite_ver !== undefined
      ? (req.body.fecha_limite_ver || null)
      : (fecha_fin ? new Date(new Date(fecha_fin).getTime() + 15 * 24 * 60 * 60 * 1000).toISOString() : null);
    const habilitado    = Boolean(req.body?.habilitado ?? false);

    if (!id_evaluation) return res.status(400).json({ error: "id_evaluation requerido" });
    if (!id_course)     return res.status(400).json({ error: "id_course requerido" });
    if (!year)          return res.status(400).json({ error: "year requerido" });

    // Verificar que el examen exista y sea de tipo Examen
    const examenTypeId = await resolveEvaluationTypeId(null, "Examen");
    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id, id_type")
      .eq("id", id_evaluation)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (ev.id_type !== examenTypeId)
      return res.status(400).json({ error: "La evaluación no es de tipo Examen" });

    // Verificar que el curso exista
    const { data: course, error: cErr } = await supabaseAdmin
      .from("course")
      .select("id")
      .eq("id", id_course)
      .maybeSingle();
    if (cErr) return res.status(500).json({ error: cErr.message });
    if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const { data, error } = await supabaseAdmin
      .from("examen_programacion")
      .insert({ id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado })
      .select("id, id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado, created_at")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ ok: true, item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando programación" });
  }
});

// ============================================================================
// TAREA 11 — PATCH /api/admin/exam-schedules/:id
// Actualiza fecha_ini, fecha_fin y/o habilitado de una programación
// ============================================================================
adminRouter.patch("/exam-schedules/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { data: prog, error: pErr } = await supabaseAdmin
      .from("examen_programacion")
      .select("id, id_course")
      .eq("id", id)
      .maybeSingle();

    if (pErr) return res.status(500).json({ error: pErr.message });
    if (!prog?.id) return res.status(404).json({ error: "Programación no existe" });

    if (prog.id_course) {
      try { await requireAnioVigenteForCourse(prog.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    const payload = {};
    if (req.body?.fecha_ini !== undefined) payload.fecha_ini = req.body.fecha_ini || null;
    if (req.body?.fecha_fin !== undefined) payload.fecha_fin = req.body.fecha_fin || null;
    if (req.body?.fecha_limite_ver !== undefined) payload.fecha_limite_ver = req.body.fecha_limite_ver || null;
    if (req.body?.habilitado !== undefined) payload.habilitado = Boolean(req.body.habilitado);

    if (Object.keys(payload).length === 0)
      return res.status(400).json({ error: "No hay campos para actualizar" });

    const { data, error } = await supabaseAdmin
      .from("examen_programacion")
      .update(payload)
      .eq("id", id)
      .select("id, id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando programación" });
  }
});

// DELETE /api/admin/exam-schedules/:id
adminRouter.delete("/exam-schedules/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { data: prog, error: progErr } = await supabaseAdmin
      .from("examen_programacion")
      .select("id_course")
      .eq("id", id)
      .maybeSingle();

    if (progErr) return res.status(500).json({ error: progErr.message });
    if (!prog) return res.status(404).json({ error: "Programación no existe" });

    if (prog.id_course) {
      try { await requireAnioVigenteForCourse(prog.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    // Desreferenciar rta_examen antes de eliminar
    await supabaseAdmin
      .from("rta_examen")
      .update({ id_programacion: null })
      .eq("id_programacion", id);

    const { error } = await supabaseAdmin
      .from("examen_programacion")
      .delete()
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error eliminando programación" });
  }
});

// GET /api/admin/exam-attempts?id_evaluation=X&id_course=Y
// Lista estudiantes del curso que ya quedaron cerrados para este examen:
// - quienes rindieron y tienen rta_examen.finalizado_at
// - quienes no presentaron y quedaron en grades con 0/0 cerrado
adminRouter.get("/exam-attempts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_evaluation = toInt(req.query.id_evaluation);
    const id_course     = toInt(req.query.id_course);
    if (!id_evaluation || !id_course)
      return res.status(400).json({ error: "id_evaluation e id_course requeridos" });

    const [{ data: rtas, error: rtaErr }, { data: gradesRows, error: gradeErr }, { data: users, error: usersErr }] =
      await Promise.all([
        supabaseAdmin
          .from("rta_examen")
          .select("id_student, calificacion, finalizado_at")
          .eq("id_evaluation", id_evaluation)
          .not("finalizado_at", "is", null),
        supabaseAdmin
          .from("grades")
          .select("id_student, grade, attempts, finished_at")
          .eq("id_exam", id_evaluation)
          .not("finished_at", "is", null),
        supabaseAdmin
          .from("users")
          .select("id, name, cedula")
          .eq("id_course", id_course),
      ]);

    if (rtaErr) return res.status(500).json({ error: rtaErr.message });
    if (gradeErr) return res.status(500).json({ error: gradeErr.message });
    if (usersErr) return res.status(500).json({ error: usersErr.message });

    const userMap = new Map((users || []).map((u) => [u.id, u]));

    const itemsMap = new Map();

    for (const r of (rtas || [])) {
      if (!userMap.has(r.id_student)) continue;
      itemsMap.set(r.id_student, {
        id_student: r.id_student,
        name: userMap.get(r.id_student)?.name ?? "—",
        cedula: userMap.get(r.id_student)?.cedula ?? "—",
        calificacion: r.calificacion,
        finalizado_at: r.finalizado_at,
        source: "rta_examen",
      });
    }

    for (const g of (gradesRows || [])) {
      if (!userMap.has(g.id_student)) continue;
      if (itemsMap.has(g.id_student)) continue;
      itemsMap.set(g.id_student, {
        id_student: g.id_student,
        name: userMap.get(g.id_student)?.name ?? "—",
        cedula: userMap.get(g.id_student)?.cedula ?? "—",
        calificacion: g.grade,
        finalizado_at: g.finished_at,
        source: "grades",
      });
    }

    const items = [...itemsMap.values()].sort((a, b) => {
      const an = String(a.name || "");
      const bn = String(b.name || "");
      return an.localeCompare(bn, "es", { sensitivity: "base" });
    });

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo intentos" });
  }
});

// DELETE /api/admin/exam-attempts
// Reinicia el intento de un estudiante (elimina rta_examen + grades)
adminRouter.delete("/exam-attempts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id_student    = cleanStr(req.body?.id_student);
    const id_evaluation = toInt(req.body?.id_evaluation);
    if (!id_student || !id_evaluation)
      return res.status(400).json({ error: "id_student e id_evaluation requeridos" });

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id_course")
      .eq("id", id_evaluation)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev) return res.status(404).json({ error: "Evaluación no encontrada" });

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { error: rtaErr } = await supabaseAdmin
      .from("rta_examen")
      .delete()
      .eq("id_student", id_student)
      .eq("id_evaluation", id_evaluation);

    if (rtaErr) return res.status(500).json({ error: rtaErr.message });

    const { error: gradeErr } = await supabaseAdmin
      .from("grades")
      .delete()
      .eq("id_student", id_student)
      .eq("id_exam", id_evaluation);

    if (gradeErr) return res.status(500).json({ error: gradeErr.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error reiniciando intento" });
  }
});

// ============================================================================
// GESTIÓN DE AÑO LECTIVO
// ============================================================================

// GET /api/admin/anio-lectivo — lista todos los años con su estado activo
adminRouter.get("/anio-lectivo", requireAuth, requireAdminOrSecretary, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("anio_lectivo")
      .select("year, nombre, activo, created_at")
      .order("year", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo años lectivos" });
  }
});

// POST /api/admin/anio-lectivo — crea un nuevo año lectivo (inactivo por defecto)
adminRouter.post("/anio-lectivo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const year   = toInt(req.body?.year);
    const nombre = cleanStr(req.body?.nombre);

    if (!year || year < 2000 || year > 2100)
      return res.status(400).json({ error: "year inválido (2000-2100)" });
    if (!nombre)
      return res.status(400).json({ error: "nombre requerido" });

    const { data, error } = await supabaseAdmin
      .from("anio_lectivo")
      .insert({ year, nombre, activo: false })
      .select("year, nombre, activo")
      .maybeSingle();

    if (error) {
      if (isUniqueViolation(error))
        return res.status(409).json({ error: `El año ${year} ya existe` });
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ ok: true, item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando año lectivo" });
  }
});

// PUT /api/admin/anio-lectivo/activo — activa un año lectivo (desactiva el anterior)
adminRouter.put("/anio-lectivo/activo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const year = toInt(req.body?.year);
    if (!year) return res.status(400).json({ error: "year requerido" });

    // Verificar que el año existe
    const { data: exists, error: exErr } = await supabaseAdmin
      .from("anio_lectivo")
      .select("year")
      .eq("year", year)
      .maybeSingle();

    if (exErr) return res.status(500).json({ error: exErr.message });
    if (!exists) return res.status(404).json({ error: `Año ${year} no encontrado` });

    // Desactivar todos los años
    const { error: deactivateErr } = await supabaseAdmin
      .from("anio_lectivo")
      .update({ activo: false })
      .neq("year", year);

    if (deactivateErr) return res.status(500).json({ error: deactivateErr.message });

    // Activar el año solicitado
    const { data, error: activateErr } = await supabaseAdmin
      .from("anio_lectivo")
      .update({ activo: true })
      .eq("year", year)
      .select("year, nombre, activo")
      .maybeSingle();

    if (activateErr) return res.status(500).json({ error: activateErr.message });

    // Invalidar caché para que el siguiente request use el año nuevo
    invalidarCacheAnioLectivo();

    return res.json({ ok: true, item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error activando año lectivo" });
  }
});

// ============================================================================
// DELETE /api/admin/delete-user?cedula=XXX
// Elimina usuario de auth (cascada a public.users y todas las tablas relacionadas)
// ============================================================================
adminRouter.delete("/delete-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    const cedula = cleanStr(req.query?.cedula);
    if (!cedula) return res.status(400).json({ error: "cedula requerida" });

    const { data: u, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, name, email")
      .eq("cedula", cedula)
      .maybeSingle();

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado" });

    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
    if (authErr) return res.status(500).json({ error: authErr.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error eliminando usuario" });
  }
});
