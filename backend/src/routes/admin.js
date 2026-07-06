import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middlewares/auth.js";
import { query } from "../db.js";
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

// ===== Auth propio: reemplaza supabaseAdmin.auth.admin.* =====
// Crea el usuario en auth.users (antes: supabaseAdmin.auth.admin.createUser).
// Lanza si el email ya existe (violación del índice único parcial de auth.users.email).
async function createAuthUser({ email, password, name, roles }) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const { rows } = await query(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, $2, now(), $3::jsonb, now(), now())
     RETURNING id, email`,
    [email, passwordHash, JSON.stringify({ name, roles })]
  );
  return rows[0];
}

// Actualiza email/password/metadata en auth.users (antes: auth.admin.updateUserById).
async function updateAuthUser(userId, { email, password, name, roles } = {}) {
  const fields = [`updated_at = now()`];
  const params = [];

  if (email !== undefined) {
    params.push(email);
    fields.push(`email = $${params.length}`);
  }
  if (password !== undefined) {
    params.push(bcrypt.hashSync(password, 10));
    fields.push(`encrypted_password = $${params.length}`);
  }
  if (name !== undefined || roles !== undefined) {
    params.push(JSON.stringify({ name, roles }));
    fields.push(`raw_user_meta_data = $${params.length}::jsonb`);
  }

  params.push(userId);
  const { rows } = await query(
    `UPDATE auth.users SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING id, email`,
    params
  );
  return rows[0];
}

// Elimina el usuario de auth.users; cascada en BD limpia public.users y tablas relacionadas
// (antes: auth.admin.deleteUser). Puede lanzar si el usuario es profesor con sesiones de
// asistencia registradas (asistencia_sesion.id_teacher tiene ON DELETE RESTRICT).
async function deleteAuthUser(userId) {
  await query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
}

// ===== Cache code -> typeId =====
const typeCache = new Map();

async function getTypeIdByCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) throw new Error("type vacío");
  if (typeCache.has(c)) return typeCache.get(c);

  const { rows } = await query(`SELECT id, code FROM type WHERE code = $1 LIMIT 1`, [c]);
  if (!rows[0]?.id) throw new Error(`No existe type '${c}' en tabla type`);

  typeCache.set(c, rows[0].id);
  return rows[0].id;
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
    const { rows: courseRows } = await query(
      `SELECT id_monitor FROM course WHERE id = $1 LIMIT 1`,
      [idCourse]
    );
    const prevMonitorId = courseRows[0]?.id_monitor;

    if (prevMonitorId && prevMonitorId !== userId) {
      const { rows: typeMRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["M"]);
      if (typeMRows[0]?.id) {
        await query(
          `DELETE FROM user_type WHERE id_user = $1 AND id_type = $2`,
          [prevMonitorId, typeMRows[0].id]
        );
      }
    }

    await query(`UPDATE course SET id_monitor = $1 WHERE id = $2`, [userId, idCourse]);
  } else {
    // Limpiar course.id_monitor si este usuario era el monitor
    await query(`UPDATE course SET id_monitor = NULL WHERE id_monitor = $1`, [userId]);
  }
}

async function replaceUserRoles(id_user, roleCodes) {
  const codes = (roleCodes || [])
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);

  if (codes.length === 0) throw new Error("roles vacíos");

  const desiredTypeIds = [];
  for (const c of codes) desiredTypeIds.push(await getTypeIdByCode(c));

  const { rows: current } = await query(`SELECT id_type FROM user_type WHERE id_user = $1`, [id_user]);

  const curSet = new Set(current.map((r) => r.id_type));
  const desSet = new Set(desiredTypeIds);

  const toDelete = [...curSet].filter((x) => !desSet.has(x));
  if (toDelete.length > 0) {
    await query(
      `DELETE FROM user_type WHERE id_user = $1 AND id_type = ANY($2::smallint[])`,
      [id_user, toDelete]
    );
  }

  for (const id_type of desiredTypeIds) {
    await query(
      `INSERT INTO user_type (id_user, id_type) VALUES ($1, $2)
       ON CONFLICT (id_user, id_type) DO NOTHING`,
      [id_user, id_type]
    );
  }
}


async function getStudentTypeId() {
  const { rows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["S"]);
  if (!rows[0]?.id) throw new Error("No existe type 'S'");
  return rows[0].id;
}

async function getStudentsByCourseIds(courseIds) {
  const ids = Array.isArray(courseIds)
    ? [...new Set(courseIds.map((x) => Number(x)).filter(Boolean))]
    : [];

  if (ids.length === 0) return [];

  const { rows: users } = await query(
    `SELECT id, name, cedula, id_course FROM users WHERE id_course = ANY($1::bigint[]) AND estado = 'Activo' ORDER BY name ASC`,
    [ids]
  );
  if (!users.length) return [];

  const studentTypeId = await getStudentTypeId();

  const { rows: roleRows } = await query(
    `SELECT id_user FROM user_type WHERE id_type = $1 AND id_user = ANY($2::uuid[])`,
    [studentTypeId, users.map((u) => u.id)]
  );

  const studentSet = new Set(roleRows.map((r) => r.id_user));
  return users.filter((u) => studentSet.has(u.id));
}

// Devuelve todos los IDs de evaluation_type con un nombre dado (todos los años).
// Usar en operaciones de lectura que necesitan filtrar por tipo sin importar el año.
async function getEvaluationTypeIdsByName(typeName) {
  const { rows } = await query(`SELECT id FROM evaluation_type WHERE type = $1`, [typeName]);
  return rows.map((r) => r.id);
}

// Cuando se carga/edita una nota manual para una evaluación de tipo "Examen", refleja el
// cambio también en rta_examen (finalizado_at + calificacion). Sin esto, el botón "Tomar
// Examen" del alumno sigue apareciendo (depende solo de rta_examen.finalizado_at) y la
// vista de resultado del examen sigue mostrando la calificación vieja. Requiere que ya
// exista la fila en grades (FK compuesta id_student+id_evaluation -> grades).
async function syncRtaExamenForManualGrade({ studentId, evaluationId, courseId, grade }) {
  const { rows: progRows } = await query(
    `SELECT id FROM examen_programacion WHERE id_evaluation = $1 AND id_course = $2 LIMIT 1`,
    [evaluationId, courseId]
  );
  const idProgramacion = progRows[0]?.id ?? null;

  await query(
    `INSERT INTO rta_examen (id_student, id_evaluation, id_programacion, iniciado_at, finalizado_at, calificacion)
     VALUES ($1, $2, $3, now(), now(), $4)
     ON CONFLICT (id_student, id_evaluation) DO UPDATE SET
       finalizado_at = COALESCE(rta_examen.finalizado_at, EXCLUDED.finalizado_at),
       calificacion = EXCLUDED.calificacion`,
    [studentId, evaluationId, idProgramacion, grade]
  );
}

// Para escrituras: busca o crea el tipo en el año especificado.
// year es obligatorio cuando se crea un nuevo tipo.
async function resolveEvaluationTypeId(id_type, type_text, year) {
  let typeId = Number(id_type || 0);
  if (typeId) return typeId;

  const raw = cleanStr(type_text);
  if (!raw) throw new Error("Selecciona un tipo o escribe type_text");

  // Buscar por (type, year)
  let sql = `SELECT id, type FROM evaluation_type WHERE type = $1`;
  const params = [raw];
  if (year) { params.push(year); sql += ` AND year = $${params.length}`; }
  sql += ` LIMIT 1`;
  const { rows: existingRows } = await query(sql, params);
  if (existingRows[0]?.id) return existingRows[0].id;

  // Crear con year
  const { rows: createdRows } = await query(
    year
      ? `INSERT INTO evaluation_type (type, year) VALUES ($1, $2) RETURNING id, type`
      : `INSERT INTO evaluation_type (type) VALUES ($1) RETURNING id, type`,
    year ? [raw, year] : [raw]
  );
  return createdRows[0].id;
}

// ============================================================================
// 0) LEVELS / MODULES / GROUPS
// ============================================================================
adminRouter.get("/levels", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { rows } = await query(
    `SELECT id, name, year FROM level WHERE year = $1 ORDER BY id ASC`,
    [year]
  );
  return res.json({ items: rows });
});

adminRouter.get("/modules", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { rows } = await query(
    `SELECT id, name, year FROM module WHERE year = $1 ORDER BY name ASC`,
    [year]
  );
  return res.json({ items: rows });
});

adminRouter.get("/groups", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { rows } = await query(
    `SELECT id, name, id_module, year FROM "group" WHERE year = $1 ORDER BY name ASC`,
    [year]
  );
  return res.json({ items: rows });
});

// ============================================================================
// 1) COURSES
// ============================================================================
adminRouter.get("/courses", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const yearFilter = toInt(req.query.year) || (await getAnioLectivoVigente());
  const { rows: data } = await query(
    `SELECT id, name, year, level, id_monitor FROM course WHERE year = $1 ORDER BY level ASC, name ASC`,
    [yearFilter]
  );

  const courseIds = data.map((c) => c.id);
  const { rows: usedRows } = courseIds.length > 0
    ? await query(`SELECT id_course FROM users WHERE id_course = ANY($1::bigint[]) AND estado = 'Activo'`, [courseIds])
    : { rows: [] };

  // Cargar nombres de monitores asignados (el monitor siempre es también alumno —
  // si está retirado, no se muestra como monitor, igual que el resto de alumnos).
  const monitorIds = [...new Set(data.map((c) => c.id_monitor).filter(Boolean))];
  let monitorMap = new Map();
  if (monitorIds.length > 0) {
    const { rows: monitorRows } = await query(
      `SELECT id, name FROM users WHERE id = ANY($1::uuid[]) AND estado = 'Activo'`,
      [monitorIds]
    );
    monitorMap = new Map(monitorRows.map((u) => [u.id, u.name]));
  }

  const usedSet = new Set(usedRows.map((r) => String(r.id_course)));
  const items = data.map((c) => ({
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

  const { rows: countRows } = await query(`SELECT count(*) FROM users WHERE id_course = $1 AND estado = 'Activo'`, [id]);
  const count = Number(countRows[0]?.count ?? 0);
  if (count > 0) return res.status(409).json({ error: "El curso tiene estudiantes asignados y no puede eliminarse." });

  await query(`DELETE FROM course WHERE id = $1`, [id]);
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

  const { rows } = await query(
    `INSERT INTO course (name, level, year) VALUES ($1, $2, $3) RETURNING id, name, year, level`,
    [name, level, year]
  );
  return res.json({ item: rows[0] });
});

// ============================================================================
// T14 — GET /api/admin/courses/:id/students
// Estudiantes del curso (para dropdown Monitor en UI)
// ============================================================================
adminRouter.get("/courses/:id/students", requireAuth, requireAdmin, async (req, res) => {
  const courseId = toInt(req.params.id);
  if (!courseId) return res.status(400).json({ error: "id inválido" });

  try {
    const { rows: typeRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["S"]);
    if (!typeRows[0]?.id) return res.status(500).json({ error: "Tipo S no encontrado" });

    const { rows: users } = await query(
      `SELECT id, name, cedula FROM users WHERE id_course = $1 AND estado = 'Activo' ORDER BY name ASC`,
      [courseId]
    );
    if (!users.length) return res.json({ items: [] });

    const { rows: roleRows } = await query(
      `SELECT id_user FROM user_type WHERE id_type = $1 AND id_user = ANY($2::uuid[])`,
      [typeRows[0].id, users.map((u) => u.id)]
    );

    const studentSet = new Set(roleRows.map((r) => r.id_user));
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
      const { rows: userRows } = await query(
        `SELECT id, id_course, estado FROM users WHERE id = $1 LIMIT 1`,
        [id_monitor]
      );
      const userRow = userRows[0];
      if (!userRow) return res.status(404).json({ error: "Usuario no encontrado" });
      if (userRow.estado !== "Activo") {
        return res.status(400).json({ error: "Este estudiante está retirado, no puede ser asignado como monitor" });
      }
      if (Number(userRow.id_course) !== courseId) {
        return res.status(400).json({ error: "El usuario no pertenece a este curso" });
      }

      // Verificar que no sea ya monitor de otro curso en el mismo año
      const { rows: courseRows } = await query(`SELECT year FROM course WHERE id = $1 LIMIT 1`, [courseId]);
      const courseRow = courseRows[0];

      const { rows: otherMonitorRows } = await query(
        `SELECT id FROM course WHERE id_monitor = $1 AND year = $2 AND id != $3 LIMIT 1`,
        [id_monitor, courseRow.year, courseId]
      );

      if (otherMonitorRows[0]) {
        return res.status(409).json({ error: "Este estudiante ya es monitor de otro curso en el mismo año lectivo" });
      }

      // Asignar rol M si no lo tiene
      const { rows: typeMRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["M"]);
      if (typeMRows[0]?.id) {
        await query(
          `INSERT INTO user_type (id_user, id_type) VALUES ($1, $2) ON CONFLICT (id_user, id_type) DO NOTHING`,
          [id_monitor, typeMRows[0].id]
        );
      }
    }

    // Si se desasigna monitor (id_monitor = null), quitar rol M del monitor anterior
    if (id_monitor === null) {
      const { rows: currentCourseRows } = await query(`SELECT id_monitor FROM course WHERE id = $1 LIMIT 1`, [courseId]);
      const currentCourse = currentCourseRows[0];

      if (currentCourse?.id_monitor) {
        const { rows: typeMRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["M"]);
        if (typeMRows[0]?.id) {
          await query(
            `DELETE FROM user_type WHERE id_user = $1 AND id_type = $2`,
            [currentCourse.id_monitor, typeMRows[0].id]
          );
        }
      }
    }

    // Actualizar course.id_monitor
    const { rows: updatedRows } = await query(
      `UPDATE course SET id_monitor = $1 WHERE id = $2 RETURNING id, name, id_monitor`,
      [id_monitor, courseId]
    );

    return res.json({ ok: true, item: updatedRows[0] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 2) CLASSES
// ============================================================================
adminRouter.get("/classes", requireAuth, requireAdminOrSecretary, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());
  const [{ rows: classData }, { rows: grpData }] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.level, c.id_module, c.id_group, c.year, c.created_at, m.id AS module_id, m.name AS module_name
       FROM class c
       LEFT JOIN module m ON m.id = c.id_module
       WHERE c.year = $1
       ORDER BY c.level ASC, c.name ASC`,
      [year]
    ),
    query(`SELECT id, name FROM "group" WHERE year = $1`, [year]),
  ]);

  const grpMap = new Map(grpData.map((g) => [g.id, g.name]));

  const items = classData.map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    id_module: c.id_module,
    module_name: c.module_name || null,
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
      const { rows: modRows } = await query(`SELECT id, name FROM module WHERE id = $1 LIMIT 1`, [id_module]);
      if (!modRows[0]?.id) return res.status(404).json({ error: "Módulo no existe" });
    }

    // grupo existente o nuevo (opcional)
    if (!id_group && new_group_name) {
      const grp = await getOrCreateGroupByName(new_group_name, vigente);
      id_group = grp.id;
    } else if (id_group) {
      const { rows: grpRows } = await query(`SELECT id, name FROM "group" WHERE id = $1 LIMIT 1`, [id_group]);
      if (!grpRows[0]?.id) return res.status(404).json({ error: "Grupo no existe" });
    }

    const { rows: createdRows } = await query(
      `INSERT INTO class (name, level, id_module, year, id_group)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, level, id_module, id_group, year, created_at`,
      [name, level, id_module, vigente, id_group || null]
    );

    return res.json({ item: createdRows[0] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando materia" });
  }
});

// ============================================================================
// 3) EVALUATION TYPES
// ============================================================================
adminRouter.get("/evaluation-types", requireAuth, requireAdmin, async (req, res) => {
  const year = toInt(req.query.year) || (await getAnioLectivoVigente());

  const { rows: data } = await query(
    `SELECT id, type, year, created_at FROM evaluation_type WHERE year = $1 ORDER BY id ASC`,
    [year]
  );

  const typeIds = data.map((t) => t.id);
  let usedSet = new Set();
  if (typeIds.length > 0) {
    const { rows: usedRows } = await query(
      `SELECT id_type FROM evaluation WHERE id_type = ANY($1::bigint[])`,
      [typeIds]
    );
    usedSet = new Set(usedRows.map((r) => String(r.id_type)));
  }

  const items = data.map((t) => ({ ...t, eval_count: usedSet.has(String(t.id)) ? 1 : 0 }));
  return res.json({ items });
});

adminRouter.delete("/evaluation-types/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "id inválido" });

  try { await requireAnioVigenteForRecord("evaluation_type", id); }
  catch (err) { return handleYearError(res, err); }

  const { rows: countRows } = await query(`SELECT count(*) FROM evaluation WHERE id_type = $1`, [id]);
  const count = Number(countRows[0]?.count ?? 0);
  if (count > 0) return res.status(409).json({ error: "El tipo tiene evaluaciones asociadas y no puede eliminarse." });

  await query(`DELETE FROM evaluation_type WHERE id = $1`, [id]);
  return res.json({ ok: true });
});

adminRouter.post("/evaluation-types", requireAuth, requireAdmin, async (req, res) => {
  const type = cleanStr(req.body?.type);
  if (!type) return res.status(400).json({ error: "type requerido" });

  const vigente = await getAnioLectivoVigente();

  const { rows: exRows } = await query(
    `SELECT id, type, year FROM evaluation_type WHERE type = $1 AND year = $2 LIMIT 1`,
    [type, vigente]
  );
  if (exRows[0]?.id) return res.json({ item: exRows[0] });

  const { rows } = await query(
    `INSERT INTO evaluation_type (type, year) VALUES ($1, $2) RETURNING id, type, year, created_at`,
    [type, vigente]
  );
  return res.json({ item: rows[0] });
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

  const { rows: tRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["T"]);
  if (!tRows[0]?.id) return res.status(500).json({ error: "No existe type 'T'" });

  const { rows: utRows } = await query(`SELECT id_user FROM user_type WHERE id_type = $1`, [tRows[0].id]);

  let ids = utRows.map((r) => r.id_user);
  if (ids.length === 0) return res.json({ items: [] });

  // Filtrar por clase específica
  if (classId) {
    const { rows: ctRows } = await query(
      `SELECT id_teacher FROM class_teacher WHERE id_class = $1 AND id_teacher = ANY($2::uuid[])`,
      [classId, ids]
    );
    const allowed = new Set(ctRows.map((r) => r.id_teacher));
    ids = ids.filter((id) => allowed.has(id));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (groupId) {
    // Filtrar por grupo: profesores que dictan materias de ese grupo
    const { rows: ctRows } = await query(
      `SELECT ct.id_teacher, c.id_group FROM class_teacher ct
       JOIN class c ON c.id = ct.id_class
       WHERE ct.id_teacher = ANY($1::uuid[])`,
      [ids]
    );
    ids = ids.filter((id) => ctRows.some((r) => r.id_teacher === id && Number(r.id_group) === groupId));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (moduleId) {
    // Filtrar por módulo: profesores que dictan materias de ese módulo
    const { rows: ctRows } = await query(
      `SELECT ct.id_teacher, c.id_module FROM class_teacher ct
       JOIN class c ON c.id = ct.id_class
       WHERE ct.id_teacher = ANY($1::uuid[])`,
      [ids]
    );
    ids = ids.filter((id) => ctRows.some((r) => r.id_teacher === id && Number(r.id_module) === moduleId));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (courseId) {
    const { rows: ctRows } = await query(
      `SELECT id_teacher FROM class_teacher WHERE id_course = $1 AND id_teacher = ANY($2::uuid[])`,
      [courseId, ids]
    );
    const allowed = new Set(ctRows.map((r) => r.id_teacher));
    ids = ids.filter((id) => allowed.has(id));
    if (ids.length === 0) return res.json({ items: [] });
  } else if (level) {
    const { rows: ctRows } = await query(
      `SELECT ct.id_teacher, c.level FROM class_teacher ct
       JOIN class c ON c.id = ct.id_class
       WHERE ct.id_teacher = ANY($1::uuid[])`,
      [ids]
    );
    ids = ids.filter((id) => ctRows.some((r) => r.id_teacher === id && Number(r.level) === level));
    if (ids.length === 0) return res.json({ items: [] });
  }

  const { rows } = await query(
    `SELECT id, name, email, cedula FROM users WHERE id = ANY($1::uuid[]) AND estado = 'Activo' ORDER BY name ASC`,
    [ids]
  );
  return res.json({ items: rows });
});

adminRouter.get("/students", requireAuth, requireAdmin, async (req, res) => {
  const q = cleanStr(req.query.q || "");

  const { rows: sRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["S"]);
  if (!sRows[0]?.id) return res.status(500).json({ error: "No existe type 'S'" });

  const { rows: utRows } = await query(`SELECT id_user FROM user_type WHERE id_type = $1`, [sRows[0].id]);

  const ids = utRows.map((r) => r.id_user);
  if (ids.length === 0) return res.json({ items: [] });

  let sql = `SELECT id, name, email, cedula, id_course FROM users WHERE id = ANY($1::uuid[]) AND estado = 'Activo'`;
  const params = [ids];
  if (q) { params.push(`%${q}%`); sql += ` AND name ILIKE $${params.length}`; }
  sql += ` ORDER BY name ASC LIMIT 200`;

  const { rows } = await query(sql, params);
  return res.json({ items: rows });
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

  const { rows } = await query(
    `INSERT INTO class_teacher (id_teacher, id_class, id_course)
     VALUES ($1, $2, $3)
     ON CONFLICT (id_teacher, id_class, id_course) DO UPDATE SET id_teacher = EXCLUDED.id_teacher
     RETURNING id_teacher, id_class, id_course, created_at`,
    [id_teacher, id_class, id_course]
  );

  return res.json({ ok: true, item: rows[0] });
});


// ============================================================================
// 6) GESTIÓN GLOBAL DE EVALUACIONES / NOTAS (ADMIN)
// ============================================================================
adminRouter.get("/courses-by-class", requireAuth, requireAdmin, async (req, res) => {
  try {
    const classId = toInt(req.query.class_id);
    if (!classId) return res.status(400).json({ error: "class_id requerido" });

    const { rows: clsRows } = await query(`SELECT id, name, level FROM class WHERE id = $1 LIMIT 1`, [classId]);
    const cls = clsRows[0];
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { rows: courses } = await query(
      `SELECT id, name, level, year FROM course WHERE level = $1 ORDER BY level ASC, id ASC`,
      [cls.level]
    );

    return res.json({ items: courses });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo cursos" });
  }
});

const ADMIN_EVAL_SELECT = `
  ev.id, ev.title, ev.percent, ev.created_at, ev.id_course, ev.id_class, ev.id_type, ev.id_teacher, ev.id_module, ev.id_group,
  co.id AS course_id, co.name AS course_name, co.level AS course_level, co.year AS course_year,
  cl.id AS class_id, cl.name AS class_name, cl.level AS class_level, cl.id_module AS class_id_module,
  et.id AS et_id, et.type AS et_type,
  te.id AS teacher_id, te.name AS teacher_name,
  m.id AS mod_id, m.name AS mod_name,
  g.id AS grp_id, g.name AS grp_name
  FROM evaluation ev
  LEFT JOIN course co ON co.id = ev.id_course
  LEFT JOIN class cl ON cl.id = ev.id_class
  LEFT JOIN evaluation_type et ON et.id = ev.id_type
  LEFT JOIN users te ON te.id = ev.id_teacher
  LEFT JOIN module m ON m.id = ev.id_module
  LEFT JOIN "group" g ON g.id = ev.id_group
`;

function mapAdminEvalRow(r) {
  return {
    id: r.id,
    title: r.title,
    percent: r.percent,
    created_at: r.created_at,
    id_course: r.id_course,
    id_class: r.id_class,
    id_type: r.id_type,
    id_teacher: r.id_teacher,
    id_module: r.id_module,
    id_group: r.id_group,
    course: r.course_id ? { id: r.course_id, name: r.course_name, level: r.course_level, year: r.course_year } : null,
    class: r.class_id ? { id: r.class_id, name: r.class_name, level: r.class_level, id_module: r.class_id_module } : null,
    evaluation_type: r.et_id ? { id: r.et_id, type: r.et_type } : null,
    teacher: r.teacher_id ? { id: r.teacher_id, name: r.teacher_name } : null,
    module: r.mod_id ? { id: r.mod_id, name: r.mod_name } : null,
    group: r.grp_id ? { id: r.grp_id, name: r.grp_name } : null,
  };
}

adminRouter.get("/evaluations", requireAuth, requireAdmin, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const classId = toInt(req.query.class_id);
    const level = toInt(req.query.level);
    const courseId = toInt(req.query.course_id);
    const teacherId = cleanStr(req.query.teacher_id);
    const moduleId = toInt(req.query.module_id);
    const groupId = toInt(req.query.group_id);

    let sql = `SELECT ${ADMIN_EVAL_SELECT} WHERE 1=1`;
    const params = [];
    if (classId)   { params.push(classId);   sql += ` AND ev.id_class = $${params.length}`; }
    if (courseId)  { params.push(courseId);  sql += ` AND ev.id_course = $${params.length}`; }
    if (teacherId) { params.push(teacherId); sql += ` AND ev.id_teacher = $${params.length}`; }
    if (moduleId)  { params.push(moduleId);  sql += ` AND ev.id_module = $${params.length}`; }
    if (groupId)   { params.push(groupId);   sql += ` AND ev.id_group = $${params.length}`; }
    sql += ` ORDER BY ev.created_at DESC`;

    const { rows } = await query(sql, params);
    let items = rows.map(mapAdminEvalRow);

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

    const { rows: clsRows } = await query(`SELECT id, name, level FROM class WHERE id = $1 LIMIT 1`, [classId]);
    const cls = clsRows[0];
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    let sql = `SELECT ${ADMIN_EVAL_SELECT} WHERE ev.id_class = $1`;
    const params = [classId];
    if (teacherId) { params.push(teacherId); sql += ` AND ev.id_teacher = $${params.length}`; }
    if (courseId)  { params.push(courseId);  sql += ` AND ev.id_course = $${params.length}`; }
    sql += ` ORDER BY ev.created_at ASC, ev.id ASC`;

    const { rows: evalRows } = await query(sql, params);
    const evals = evalRows.map(mapAdminEvalRow);

    const courseIds = courseId
      ? [courseId]
      : [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];

    const studentsRaw = await getStudentsByCourseIds(courseIds);

    const { rows: courses } = courseIds.length
      ? await query(`SELECT id, name FROM course WHERE id = ANY($1::bigint[])`, [courseIds])
      : { rows: [] };

    const courseNameMap = new Map(courses.map((c) => [Number(c.id), c.name]));

    const students = studentsRaw.map((u) => ({
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
      const { rows: gRows } = await query(
        `SELECT id_student, id_exam, grade, finished_at, attempts, created_at, updated_at FROM grades
         WHERE id_exam = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
        [examIds, studentIds]
      );
      grades = gRows;
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

    let sql = `SELECT ${ADMIN_EVAL_SELECT} WHERE ev.id_group = $1`;
    const params = [groupId];
    if (courseId) { params.push(courseId); sql += ` AND ev.id_course = $${params.length}`; }
    sql += ` ORDER BY ev.created_at ASC, ev.id ASC`;

    const { rows: evRows } = await query(sql, params);
    const evals = evRows.map(mapAdminEvalRow);

    const group = evals[0]?.group ?? { id: groupId, name: `Grupo ${groupId}` };
    const courseIds = [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];
    const studentsRaw = courseIds.length > 0 ? await getStudentsByCourseIds(courseIds) : [];

    let courseNameMap = new Map();
    if (courseIds.length > 0) {
      const { rows: cRows } = await query(`SELECT id, name FROM course WHERE id = ANY($1::bigint[])`, [courseIds]);
      courseNameMap = new Map(cRows.map((c) => [Number(c.id), c.name]));
    }

    const students = studentsRaw.map((u) => ({
      id: u.id, name: u.name, cedula: u.cedula,
      id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    const examIds = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);
    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
      const { rows: gRows } = await query(
        `SELECT id_student, id_exam, grade, finished_at, attempts FROM grades
         WHERE id_exam = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
        [examIds, studentIds]
      );
      grades = gRows;
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
    let classSql = `SELECT id, name, level, id_module FROM class WHERE 1=1`;
    const classParams = [];
    if (classId) {
      classParams.push(classId); classSql += ` AND id = $${classParams.length}`;
    } else {
      if (level && level > 0) { classParams.push(level); classSql += ` AND level = $${classParams.length}`; }
      if (moduleId)           { classParams.push(moduleId); classSql += ` AND id_module = $${classParams.length}`; }
    }
    classSql += ` ORDER BY level, name`;

    const { rows: classRows } = await query(classSql, classParams);
    const classIds = classRows.map((c) => c.id);
    if (classIds.length === 0)
      return res.json({ classes: [], evaluations: [], students: [], grades: [] });

    const includeGroupEvaluations = !classId;
    const moduleIds = includeGroupEvaluations
      ? [...new Set(classRows.map((c) => Number(c.id_module)).filter(Boolean))]
      : [];

    // 2. Get evaluations for those classes plus grouped evaluations in the same scope
    let classEvSql = `SELECT ${ADMIN_EVAL_SELECT} WHERE ev.id_class = ANY($1::bigint[])`;
    const classEvParams = [classIds];
    if (courseId) { classEvParams.push(courseId); classEvSql += ` AND ev.id_course = $${classEvParams.length}`; }
    classEvSql += ` ORDER BY ev.id_class ASC, ev.created_at ASC, ev.id ASC`;

    let groupEvSql = `SELECT ${ADMIN_EVAL_SELECT} WHERE ev.id_module = ANY($1::bigint[]) AND ev.id_group IS NOT NULL`;
    const groupEvParams = [moduleIds];
    if (courseId) { groupEvParams.push(courseId); groupEvSql += ` AND ev.id_course = $${groupEvParams.length}`; }
    groupEvSql += ` ORDER BY ev.id_group ASC, ev.created_at ASC, ev.id ASC`;

    const [{ rows: classEvaluations }, { rows: groupEvaluations }] = await Promise.all([
      query(classEvSql, classEvParams),
      moduleIds.length ? query(groupEvSql, groupEvParams) : Promise.resolve({ rows: [] }),
    ]);

    const evals = [...classEvaluations.map(mapAdminEvalRow), ...groupEvaluations.map(mapAdminEvalRow)];

    // 3. Resolve course IDs for student lookup
    let courseIds = courseId
      ? [courseId]
      : [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];

    // If still empty (no evals yet), fall back to courses of the level
    if (courseIds.length === 0) {
      let cSql = `SELECT id FROM course WHERE 1=1`;
      const cParams = [];
      if (courseId) { cParams.push(courseId); cSql += ` AND id = $${cParams.length}`; }
      else if (level && level > 0) { cParams.push(level); cSql += ` AND level = $${cParams.length}`; }
      const { rows: cRows } = await query(cSql, cParams);
      courseIds = cRows.map((c) => Number(c.id));
    }

    // 4. Students
    const studentsRaw = await getStudentsByCourseIds(courseIds);
    const { rows: coursesInfo } = courseIds.length
      ? await query(`SELECT id, name FROM course WHERE id = ANY($1::bigint[])`, [courseIds])
      : { rows: [] };
    const courseNameMap = new Map(coursesInfo.map((c) => [Number(c.id), c.name]));
    const students = studentsRaw.map((u) => ({
      id: u.id, name: u.name, cedula: u.cedula, id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    // 5. Grades
    const examIds    = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);
    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
      const { rows: gRows } = await query(
        `SELECT id_student, id_exam, grade, finished_at, attempts, created_at, updated_at FROM grades
         WHERE id_exam = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
        [examIds, studentIds]
      );
      grades = gRows;
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

    const { rows: evRows } = await query(`SELECT id FROM evaluation WHERE id = $1 LIMIT 1`, [examId]);
    if (!evRows[0]?.id) return res.status(404).json({ error: "Evaluación no existe" });

    await closeExpiredExams({ evaluationIds: [examId] });

    const { rows } = await query(
      `SELECT id_student, grade, finished_at, attempts, created_at, updated_at FROM grades WHERE id_exam = $1`,
      [examId]
    );

    return res.json({ items: rows });
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

    const { rows: clsRows } = await query(
      `SELECT id, name, level, id_module, id_group FROM class WHERE id = $1 LIMIT 1`,
      [id_class]
    );
    const cls = clsRows[0];
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });
    if (cls.id_group) return res.status(400).json({
      error: "Esta materia pertenece a un grupo de evaluación. Las evaluaciones deben crearse a nivel de grupo.",
    });

    const { rows: courseRows } = await query(
      `SELECT id, name, level, year FROM course WHERE id = $1 LIMIT 1`,
      [id_course]
    );
    const course = courseRows[0];
    if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

    if (Number(course.level) !== Number(cls.level)) {
      return res.status(400).json({
        error: "El curso seleccionado no corresponde al mismo level de la materia",
      });
    }

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const typeId = await resolveEvaluationTypeId(id_type, type_text, course.year);

    const { rows } = await query(
      `INSERT INTO evaluation (id_course, id_teacher, id_type, percent, title, id_module, id_class)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, percent, created_at, id_course, id_class, id_type, id_teacher`,
      [id_course, id_teacher, typeId, percent, title, cls.id_module || null, id_class]
    );

    return res.json({ item: rows[0] });
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

    const { rows: evRows } = await query(
      `SELECT ev.id, ev.id_course, et.type AS evaluation_type
       FROM evaluation ev
       LEFT JOIN evaluation_type et ON et.id = ev.id_type
       WHERE ev.id = $1 LIMIT 1`,
      [examId]
    );
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    const { rows: stRows } = await query(
      ced
        ? `SELECT id, cedula, name, email, id_course, estado FROM users WHERE cedula = $1 LIMIT 1`
        : `SELECT id, cedula, name, email, id_course, estado FROM users WHERE id = $1 LIMIT 1`,
      [ced || stId]
    );
    const st = stRows[0];

    if (!st?.id) return res.status(404).json({ error: ced ? "No existe estudiante con esa cédula" : "No existe estudiante con ese id" });
    if (st.estado !== "Activo") {
      return res.status(400).json({ error: "Este estudiante está retirado, no se le puede asignar una nota" });
    }

    if (Number(st.id_course) !== Number(ev.id_course)) {
      return res.status(400).json({ error: "El estudiante no pertenece al curso de esta evaluación" });
    }

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { rows: existingGradeRows } = await query(
      `SELECT attempts FROM grades WHERE id_exam = $1 AND id_student = $2 LIMIT 1`,
      [examId, st.id]
    );

    const finishedAt = new Date().toISOString();
    const attempts = Number(existingGradeRows[0]?.attempts ?? 0) + 1;

    const { rows: gradeRows } = await query(
      `INSERT INTO grades (id_exam, id_student, grade, finished_at, attempts)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id_exam, id_student)
       DO UPDATE SET grade = EXCLUDED.grade, finished_at = EXCLUDED.finished_at, attempts = EXCLUDED.attempts
       RETURNING id_exam, id_student, grade, finished_at`,
      [examId, st.id, grade, finishedAt, attempts]
    );

    if (ev.evaluation_type === "Examen") {
      await syncRtaExamenForManualGrade({
        studentId: st.id,
        evaluationId: examId,
        courseId: ev.id_course,
        grade,
      });
    }

    return res.json({
      ok: true,
      student: { id: st.id, cedula: st.cedula, name: st.name },
      grade: gradeRows[0],
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error subiendo nota" });
  }
});

adminRouter.patch("/evaluations/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { rows: evRows } = await query(
      `SELECT id, id_class, id_course, id_teacher, id_type, title, percent FROM evaluation WHERE id = $1 LIMIT 1`,
      [id]
    );
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    const fields = [];
    const params = [];

    if (req.body?.percent !== undefined) {
      const percent = Number(req.body.percent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        return res.status(400).json({ error: "Percent inválido (1..100)" });
      }
      params.push(percent); fields.push(`percent = $${params.length}`);
    }

    if (req.body?.title !== undefined) {
      const title = cleanStr(req.body.title);
      if (!title) return res.status(400).json({ error: "title inválido" });
      params.push(title); fields.push(`title = $${params.length}`);
    }

    if (req.body?.id_type !== undefined || req.body?.type_text !== undefined) {
      const idType = await resolveEvaluationTypeId(req.body?.id_type, req.body?.type_text);
      params.push(idType); fields.push(`id_type = $${params.length}`);
    }

    if (req.body?.id_teacher !== undefined) {
      const id_teacher = cleanStr(req.body.id_teacher);
      if (!id_teacher) return res.status(400).json({ error: "id_teacher inválido" });

      // Solo validar class_teacher para evaluaciones de nivel materia
      if (ev.id_class) {
        const { rows: linkRows } = await query(
          `SELECT id_teacher, id_class FROM class_teacher WHERE id_teacher = $1 AND id_class = $2 LIMIT 1`,
          [id_teacher, ev.id_class]
        );
        if (!linkRows[0]?.id_teacher) {
          return res.status(400).json({ error: "Ese profesor no está asignado a esa materia" });
        }
      }

      params.push(id_teacher); fields.push(`id_teacher = $${params.length}`);
    }

    if (req.body?.id_course !== undefined) {
      const id_course = toInt(req.body.id_course);
      if (!id_course) return res.status(400).json({ error: "id_course inválido" });

      const { rows: clsRows } = await query(`SELECT id, level FROM class WHERE id = $1 LIMIT 1`, [ev.id_class]);
      const cls = clsRows[0];
      if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

      const { rows: courseRows } = await query(`SELECT id, level FROM course WHERE id = $1 LIMIT 1`, [id_course]);
      const course = courseRows[0];
      if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

      if (Number(course.level) !== Number(cls.level)) {
        return res.status(400).json({
          error: "El curso seleccionado no corresponde al mismo level de la materia",
        });
      }

      params.push(id_course); fields.push(`id_course = $${params.length}`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    params.push(id);
    const { rows } = await query(
      `UPDATE evaluation SET ${fields.join(", ")} WHERE id = $${params.length}
       RETURNING id, title, percent, id_type, id_teacher, id_course, id_class, created_at`,
      params
    );

    return res.json({ item: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando evaluación" });
  }
});


adminRouter.delete("/evaluations/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { rows: evRows } = await query(`SELECT id, id_course FROM evaluation WHERE id = $1 LIMIT 1`, [id]);
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    await query(`DELETE FROM evaluation WHERE id = $1`, [id]);
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

    const { rows: grpRows } = await query(`SELECT id, id_module FROM "group" WHERE id = $1 LIMIT 1`, [id_group]);
    const grp = grpRows[0];
    if (!grp?.id) return res.status(404).json({ error: "Grupo no existe" });

    const vigente = await getAnioLectivoVigente();
    const typeId = await resolveEvaluationTypeId(id_type, type_text, vigente);

    const { rows } = await query(
      `INSERT INTO evaluation (id_course, id_teacher, id_type, percent, title, id_group, id_module)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, percent, id_course, id_class, id_type, id_teacher, id_module, id_group, created_at`,
      [id_course || null, id_teacher, typeId, percent, title, id_group, grp.id_module]
    );

    return res.json({ item: rows[0] });
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
    const { rows: courses } = await query(`SELECT id, name FROM course ORDER BY name`);

    const courseNames = courses.map((c) => c.name);
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
        const { rows: courseMatchRows } = await query(
          `SELECT id, year FROM course WHERE name = $1 LIMIT 1`,
          [courseNameRaw]
        );
        if (courseMatchRows[0]) {
          id_course = courseMatchRows[0].id;
        } else {
          const asInt = toInt(courseNameRaw);
          if (asInt) {
            const { rows: courseByIdRows } = await query(
              `SELECT id, year FROM course WHERE id = $1 LIMIT 1`,
              [asInt]
            );
            if (courseByIdRows[0]) id_course = courseByIdRows[0].id;
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
      const { rows: cedulaDupRows } = await query(
        `SELECT id, email FROM users WHERE cedula = $1 LIMIT 1`,
        [cedula]
      );
      const cedulaDup = cedulaDupRows[0];
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
      let createError = null;

      try {
        const created = await createAuthUser({ email, password: DEFAULT_PASSWORD, name, roles: typeList });
        authUserId = created.id;
      } catch (e) {
        createError = e;
      }

      if (createError) {
        const msg = createError.message || "Error creando auth user";

        const { rows: existingRows } = await query(
          `SELECT id, email FROM users WHERE email = $1 LIMIT 1`,
          [email]
        );
        const existing = existingRows[0];

        if (!existing?.id) {
          results.errors.push({
            row: rowNum,
            error: `${msg} (y no existe registro en public.users para ese email)`,
          });
          results.skipped++;
          continue;
        }

        authUserId = existing.id;
      }

      const payload = {
        id: authUserId,
        email,
        name,
        cedula,
        code_jiliu,
        id_course,
      };

      let up;
      try {
        const { rows: upRows } = await query(
          `INSERT INTO users (id, email, name, cedula, code_jiliu, id_course)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             email = EXCLUDED.email, name = EXCLUDED.name, cedula = EXCLUDED.cedula,
             code_jiliu = EXCLUDED.code_jiliu, id_course = EXCLUDED.id_course
           RETURNING id, email, name, cedula, code_jiliu, id_course, estado`,
          [payload.id, payload.email, payload.name, payload.cedula, payload.code_jiliu, payload.id_course]
        );
        up = upRows[0];
      } catch (e) {
        results.errors.push({ row: rowNum, error: e.message });
        results.skipped++;
        continue;
      }

      try {
        await replaceUserRoles(authUserId, typeList);
      } catch (e) {
        results.errors.push({ row: rowNum, error: `roles: ${e?.message || "error reemplazando roles"}` });
      }

      if (createError) {
        try {
          await updateAuthUser(authUserId, { name, roles: typeList });
        } catch (e) {
          results.errors.push({ row: rowNum, error: `auth metadata: ${e.message}` });
        }
      }

      if (!(payload.id_course == null)) {
        try {
          await query(
            `INSERT INTO user_history (id_student, id_course) VALUES ($1, $2)
             ON CONFLICT (id_student, id_course) DO NOTHING`,
            [authUserId, id_course]
          );
        } catch (e) {
          results.errors.push({ row: rowNum, error: `history: ${e.message}` });
        }
      }

      if (createError) results.updated++;
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

    const { rows: data } = await query(
      `SELECT u.id, u.name, u.email, u.cedula, u.code_jiliu, u.id_course, u.estado, c.id AS course_id, c.name AS course_name
       FROM users u
       LEFT JOIN course c ON c.id = u.id_course
       WHERE u.cedula ILIKE $1 OR u.name ILIKE $1 OR u.email ILIKE $1 OR u.code_jiliu ILIKE $1
       LIMIT 30`,
      [pattern]
    );

    const items = await Promise.all(data.map(async (u) => {
      const { rows: ut } = await query(
        `SELECT t.code FROM user_type ut JOIN type t ON t.id = ut.id_type WHERE ut.id_user = $1`,
        [u.id]
      );
      const roles = ut.map((r) => r.code).filter(Boolean);
      const { course_id, course_name, ...rest } = u;
      return { ...rest, roles, course_name: course_name || null };
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

    const { rows: uRows } = await query(
      `SELECT id, name, email, cedula, code_jiliu, id_course, estado FROM users WHERE cedula = $1 LIMIT 1`,
      [cedula]
    );
    const u = uRows[0];
    if (!u) return res.status(404).json({ error: "No encontrado" });

    const { rows: ut } = await query(
      `SELECT ut.id_type, t.code FROM user_type ut JOIN type t ON t.id = ut.id_type WHERE ut.id_user = $1`,
      [u.id]
    );

    const roles = ut.map((r) => r.code).filter(Boolean);

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
    const estadoRaw = cleanStr(req.body?.estado);
    const estado = ["Activo", "Retirado"].includes(estadoRaw) ? estadoRaw : "Activo";

    if (!email || !email.includes("@")) return res.status(400).json({ error: "email inválido" });
    if (!name) return res.status(400).json({ error: "name requerido" });

    // Verificar que el email no esté ya registrado
    const { rows: emailExistsRows } = await query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (emailExistsRows[0]?.id) {
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
    let createError = null;

    try {
      const created = await createAuthUser({ email, password: DEFAULT_PASSWORD, name, roles: roleList });
      authUserId = created.id;
    } catch (e) {
      createError = e;
    }

    if (createError) {
      const { rows: existingRows } = await query(`SELECT id, email FROM users WHERE email = $1 LIMIT 1`, [email]);
      const existing = existingRows[0];
      if (!existing?.id) {
        return res.status(400).json({
          error: (createError.message || "No se pudo crear") + " (y no existe en public.users)",
        });
      }

      authUserId = existing.id;

      try {
        await updateAuthUser(authUserId, { email, name, roles: roleList });
      } catch (e) {
        console.warn("[create-user] WARN auth update:", e.message);
      }
    }

    const payload = {
      id: authUserId,
      email,
      name,
      cedula,
      code_jiliu,
      id_course,
      estado,
    };

    let up;
    try {
      const { rows: upRows } = await query(
        `INSERT INTO users (id, email, name, cedula, code_jiliu, id_course, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email, name = EXCLUDED.name, cedula = EXCLUDED.cedula,
           code_jiliu = EXCLUDED.code_jiliu, id_course = EXCLUDED.id_course, estado = EXCLUDED.estado
         RETURNING id, email, name, cedula, code_jiliu, id_course, estado`,
        [payload.id, payload.email, payload.name, payload.cedula, payload.code_jiliu, payload.id_course, payload.estado]
      );
      up = upRows[0];
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    await replaceUserRoles(authUserId, roleList);

    if (!(payload.id_course == null)) {
      try {
        await query(
          `INSERT INTO user_history (id_student, id_course) VALUES ($1, $2)
           ON CONFLICT (id_student, id_course) DO NOTHING`,
          [authUserId, id_course]
        );
      } catch (e) {
        return res.json({ ok: true, item: up, warn: `history: ${e.message}`, created: !createError });
      }
    }

    await syncMonitorCourse(authUserId, id_course, roleList.includes("M"));

    return res.json({ ok: true, item: up, created: !createError });
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
    const estadoRaw = cleanStr(req.body?.estado);

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

    const { rows: uRows } = await query(
      `SELECT id, cedula, email, estado FROM users WHERE cedula = $1 LIMIT 1`,
      [cedula]
    );
    const u = uRows[0];
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado con esa cédula" });

    const userId = u.id;
    const oldEmail = (u.email || "").toLowerCase();
    const estado = ["Activo", "Retirado"].includes(estadoRaw) ? estadoRaw : u.estado;

    const { rows: codeDupRows } = await query(
      `SELECT id FROM users WHERE code_jiliu = $1 AND id != $2 LIMIT 1`,
      [code_jiliu, userId]
    );
    if (codeDupRows.length > 0) {
      return res.status(409).json({ error: "Ese code_jiliu ya está en uso por otro usuario." });
    }

    const { rows: emailDupRows } = await query(
      `SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1`,
      [email, userId]
    );
    if (emailDupRows.length > 0) {
      return res.status(409).json({ error: "Ese email ya está en uso por otro usuario." });
    }

    let warn = null;

    try {
      await updateAuthUser(userId, {
        name,
        roles: roleList,
        ...(email !== oldEmail ? { email } : {}),
      });
    } catch (e) {
      return res.status(400).json({ error: `Auth: ${e.message}` });
    }

    let up;
    try {
      const { rows: upRows } = await query(
        `UPDATE users SET email = $1, name = $2, code_jiliu = $3, id_course = $4, estado = $5 WHERE id = $6
         RETURNING id, email, name, cedula, code_jiliu, id_course, estado`,
        [email, name, code_jiliu, id_course, estado, userId]
      );
      up = upRows[0];
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ error: "Conflicto: email o code_jiliu ya existen." });
      }
      return res.status(500).json({ error: e.message });
    }

    await replaceUserRoles(userId, roleList);

    try {
      await query(
        `INSERT INTO user_history (id_student, id_course) VALUES ($1, $2)
         ON CONFLICT (id_student, id_course) DO NOTHING`,
        [userId, id_course]
      );
    } catch (e) {
      warn = `history: ${e.message}`;
    }

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

    const { rows: uRows } = await query(
      `SELECT id, email, name, cedula, code_jiliu, id_course, estado FROM users WHERE cedula = $1 LIMIT 1`,
      [cedula]
    );
    const u = uRows[0];
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado" });

    const { rows: roleRows } = await query(
      `SELECT ut.id_type, t.id AS type_id, t.code FROM user_type ut JOIN type t ON t.id = ut.id_type WHERE ut.id_user = $1`,
      [u.id]
    );

    const roles = roleRows.map((r) => r.code).filter(Boolean);

    return res.json({ ok: true, item: { ...u, roles } });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error buscando usuario" });
  }
});

async function getOrCreateModuleByName(name, year) {
  const cleanName = cleanStr(name);
  if (!cleanName) throw new Error("Nombre de módulo requerido");
  if (!year) throw new Error("year requerido en getOrCreateModuleByName");

  const { rows: existingRows } = await query(
    `SELECT id, name FROM module WHERE name ILIKE $1 AND year = $2 LIMIT 1`,
    [cleanName, year]
  );
  if (existingRows[0]?.id) return existingRows[0];

  const { rows: createdRows } = await query(
    `INSERT INTO module (name, year) VALUES ($1, $2) RETURNING id, name`,
    [cleanName, year]
  );
  return createdRows[0];
}

async function getOrCreateGroupByName(name, year) {
  const cleanName = cleanStr(name);
  if (!cleanName) throw new Error("Nombre de grupo requerido");
  if (!year) throw new Error("year requerido en getOrCreateGroupByName");

  const { rows: existingRows } = await query(
    `SELECT id, name FROM "group" WHERE name ILIKE $1 AND year = $2 LIMIT 1`,
    [cleanName, year]
  );
  if (existingRows[0]?.id) return existingRows[0];

  const { rows: createdRows } = await query(
    `INSERT INTO "group" (name, year) VALUES ($1, $2) RETURNING id, name`,
    [cleanName, year]
  );
  return createdRows[0];
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

    await query(
      `DELETE FROM class_teacher WHERE id_teacher = $1 AND id_class = $2 AND id_course = $3`,
      [id_teacher, id_class, id_course]
    );

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

    const { rows: uRows } = await query(`SELECT id, email FROM users WHERE cedula = $1 LIMIT 1`, [cedula]);
    const u = uRows[0];
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado con esa cédula" });

    // Eliminar de auth.users (también elimina sesiones activas)
    try {
      await deleteAuthUser(u.id);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

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
    let coursesSql = `SELECT id, name, level FROM course WHERE 1=1`;
    const coursesParams = [];
    if (id_course) { coursesParams.push(id_course); coursesSql += ` AND id = $${coursesParams.length}`; }
    else if (id_level) { coursesParams.push(id_level); coursesSql += ` AND level = $${coursesParams.length}`; }
    coursesSql += ` ORDER BY level, name`;

    const { rows: coursesList } = await query(coursesSql, coursesParams);
    if (coursesList.length === 0) return res.json({ rows: [] });

    // 2) Determine classes scope (union of all levels from selected courses)
    const levelSet = [...new Set(coursesList.map((c) => c.level))];
    const { rows: classData } = await query(
      `SELECT id, name, level, id_module, id_group FROM class WHERE level = ANY($1::int[]) ORDER BY name`,
      [levelSet]
    );

    const courseIds = coursesList.map((c) => c.id);
    const { rows: ctData } = await query(
      `SELECT id_class, id_teacher, id_course FROM class_teacher WHERE id_course = ANY($1::bigint[])`,
      [courseIds]
    );

    // 3) Build module and group maps
    const moduleIds = [...new Set(classData.map((c) => c.id_module).filter(Boolean))];
    const moduleMap = new Map();
    if (moduleIds.length > 0) {
      const { rows: modData } = await query(`SELECT id, name FROM module WHERE id = ANY($1::bigint[])`, [moduleIds]);
      for (const m of modData) moduleMap.set(m.id, m.name);
    }

    const groupIds = [...new Set(classData.map((c) => c.id_group).filter(Boolean))];
    const groupMap = new Map();
    if (groupIds.length > 0) {
      const { rows: grpData } = await query(`SELECT id, name FROM "group" WHERE id = ANY($1::bigint[])`, [groupIds]);
      for (const g of grpData) groupMap.set(g.id, g.name);
    }

    // 4) Build key map: "id_class_id_course" -> id_teacher
    const ctMap = new Map();
    for (const r of ctData) ctMap.set(`${r.id_class}_${r.id_course}`, r.id_teacher);

    // 5) One row per (course × class) with matching level
    const rows = [];
    for (const course of coursesList) {
      for (const cls of classData) {
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
        await query(
          `DELETE FROM class_teacher WHERE id_course = $1 AND id_class = ANY($2::bigint[])`,
          [id_course, classIds]
        );

        // 1 INSERT bulk para las que tienen profesor asignado
        const toInsert = courseRows.filter((r) => r.id_teacher);
        if (toInsert.length > 0) {
          const values = [];
          const placeholders = toInsert.map((r, idx) => {
            const base = idx * 3;
            values.push(r.id_teacher, r.id_class, id_course);
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
          });
          await query(
            `INSERT INTO class_teacher (id_teacher, id_class, id_course) VALUES ${placeholders.join(", ")}`,
            values
          );
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
      const { rows: clsRows } = await query(
        `SELECT id, name, level, id_module, id_group FROM class WHERE id = $1 LIMIT 1`,
        [id_class]
      );
      const cls = clsRows[0];
      if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });
      if (cls.id_group) return res.status(400).json({
        error: "Esta materia pertenece a un grupo de evaluación. Los exámenes deben crearse a nivel de grupo.",
      });

      const { rows: courseRows } = await query(
        `SELECT id, name, level, year FROM course WHERE id = $1 LIMIT 1`,
        [id_course]
      );
      const course = courseRows[0];
      if (!course?.id) return res.status(404).json({ error: "Curso no existe" });
      if (Number(course.level) !== Number(cls.level))
        return res.status(400).json({ error: "El curso no corresponde al nivel de la materia" });

      id_class_resolved  = id_class;
      id_module_resolved = cls.id_module || null;
      courseYear         = course.year;
    } else {
      const { rows: grpRows } = await query(`SELECT id, id_module FROM "group" WHERE id = $1 LIMIT 1`, [id_group]);
      const grp = grpRows[0];
      if (!grp?.id) return res.status(404).json({ error: "Grupo no existe" });

      const { rows: courseRows } = await query(
        `SELECT id, name, level, year FROM course WHERE id = $1 LIMIT 1`,
        [id_course]
      );
      const course = courseRows[0];
      if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

      id_group_resolved  = id_group;
      id_module_resolved = grp.id_module || null;
      courseYear         = course.year;
    }

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const examenTypeId = await resolveEvaluationTypeId(null, "Examen", courseYear);

    const { rows: evalRows } = await query(
      `INSERT INTO evaluation (id_course, id_class, id_group, id_teacher, id_type, percent, title, id_module, tiempo_minutos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, percent, tiempo_minutos, created_at`,
      [id_course, id_class_resolved, id_group_resolved, id_teacher, examenTypeId, percent, title, id_module_resolved, tiempo_minutos]
    );
    const evalData = evalRows[0];

    // Insertar preguntas en examen_detalle
    const values = [];
    const placeholders = preguntas.map((p, idx) => {
      const base = idx * 7;
      values.push(
        evalData.id,
        idx + 1,
        p.tipo,
        cleanStr(p.enunciado),
        Number(p.puntos),
        JSON.stringify(p.opciones),
        JSON.stringify(p.respuesta_correcta)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    try {
      await query(
        `INSERT INTO examen_detalle (id_evaluation, orden, tipo, enunciado, puntos, opciones, respuesta_correcta)
         VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (detErr) {
      // Rollback: eliminar el evaluation recién creado
      await query(`DELETE FROM evaluation WHERE id = $1`, [evalData.id]);
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

    let sql = `
      SELECT ev.id, ev.title, ev.percent, ev.tiempo_minutos, ev.created_at, ev.id_teacher,
             ev.id_course, ev.id_class, ev.id_module, ev.id_group,
             co.id AS course_id, co.name AS course_name, co.year AS course_year, co.level AS course_level,
             cl.id AS class_id, cl.name AS class_name, cl.level AS class_level, cl.id_module AS class_id_module,
             m.id AS mod_id, m.name AS mod_name,
             g.id AS grp_id, g.name AS grp_name,
             te.id AS teacher_id, te.name AS teacher_name
      FROM evaluation ev
      LEFT JOIN course co ON co.id = ev.id_course
      LEFT JOIN class cl ON cl.id = ev.id_class
      LEFT JOIN module m ON m.id = ev.id_module
      LEFT JOIN "group" g ON g.id = ev.id_group
      LEFT JOIN users te ON te.id = ev.id_teacher
      WHERE ev.id_type = ANY($1::bigint[])
    `;
    const params = [examenTypeIds];
    if (req.query.id_course) { params.push(toInt(req.query.id_course)); sql += ` AND ev.id_course = $${params.length}`; }
    if (req.query.id_class)  { params.push(toInt(req.query.id_class));  sql += ` AND ev.id_class = $${params.length}`; }
    if (req.query.id_module) { params.push(toInt(req.query.id_module)); sql += ` AND ev.id_module = $${params.length}`; }
    if (req.query.id_group)  { params.push(toInt(req.query.id_group));  sql += ` AND ev.id_group = $${params.length}`; }
    sql += ` ORDER BY ev.created_at DESC`;

    const { rows: evalRows } = await query(sql, params);
    if (!evalRows.length) return res.json({ items: [] });

    const evals = evalRows.map((r) => ({
      id: r.id, title: r.title, percent: r.percent, tiempo_minutos: r.tiempo_minutos, created_at: r.created_at,
      id_teacher: r.id_teacher, id_course: r.id_course, id_class: r.id_class, id_module: r.id_module, id_group: r.id_group,
      course: r.course_id ? { id: r.course_id, name: r.course_name, year: r.course_year, level: r.course_level } : null,
      class: r.class_id ? { id: r.class_id, name: r.class_name, level: r.class_level, id_module: r.class_id_module } : null,
      module: r.mod_id ? { id: r.mod_id, name: r.mod_name } : null,
      group: r.grp_id ? { id: r.grp_id, name: r.grp_name } : null,
      teacher: r.teacher_id ? { id: r.teacher_id, name: r.teacher_name } : null,
    }));

    // Traer preguntas (sin respuesta_correcta para listado — solo metadatos)
    const evalIds = evals.map((e) => e.id);
    const { rows: detalle } = await query(
      `SELECT id, id_evaluation, orden, tipo, enunciado, puntos, opciones, respuesta_correcta FROM examen_detalle
       WHERE id_evaluation = ANY($1::bigint[]) ORDER BY id_evaluation, orden`,
      [evalIds]
    );

    const detalleMap = new Map();
    for (const d of detalle) {
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
    const { rows: evRows } = await query(`SELECT id, id_type, id_course FROM evaluation WHERE id = $1 LIMIT 1`, [id]);
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (!examenTypeIds.includes(ev.id_type))
      return res.status(400).json({ error: "Esta evaluación no es de tipo Examen" });

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    await query(`DELETE FROM evaluation WHERE id = $1`, [id]);

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
    const { rows: evRows } = await query(
      `SELECT ev.id, ev.title, ev.percent, ev.tiempo_minutos, ev.created_at, ev.id_teacher,
              ev.id_course, ev.id_class, ev.id_module, ev.id_group,
              co.id AS course_id, co.name AS course_name, co.year AS course_year, co.level AS course_level,
              cl.id AS class_id, cl.name AS class_name, cl.level AS class_level,
              m.id AS mod_id, m.name AS mod_name,
              g.id AS grp_id, g.name AS grp_name,
              te.id AS teacher_id, te.name AS teacher_name
       FROM evaluation ev
       LEFT JOIN course co ON co.id = ev.id_course
       LEFT JOIN class cl ON cl.id = ev.id_class
       LEFT JOIN module m ON m.id = ev.id_module
       LEFT JOIN "group" g ON g.id = ev.id_group
       LEFT JOIN users te ON te.id = ev.id_teacher
       WHERE ev.id = $1 AND ev.id_type = ANY($2::bigint[])
       LIMIT 1`,
      [id, examenTypeIds]
    );
    const r = evRows[0];
    if (!r?.id) return res.status(404).json({ error: "Examen no existe" });

    const ev = {
      id: r.id, title: r.title, percent: r.percent, tiempo_minutos: r.tiempo_minutos, created_at: r.created_at,
      id_teacher: r.id_teacher, id_course: r.id_course, id_class: r.id_class, id_module: r.id_module, id_group: r.id_group,
      course: r.course_id ? { id: r.course_id, name: r.course_name, year: r.course_year, level: r.course_level } : null,
      class: r.class_id ? { id: r.class_id, name: r.class_name, level: r.class_level } : null,
      module: r.mod_id ? { id: r.mod_id, name: r.mod_name } : null,
      group: r.grp_id ? { id: r.grp_id, name: r.grp_name } : null,
      teacher: r.teacher_id ? { id: r.teacher_id, name: r.teacher_name } : null,
    };

    const { rows: preguntas } = await query(
      `SELECT id, orden, tipo, enunciado, puntos, opciones, respuesta_correcta FROM examen_detalle
       WHERE id_evaluation = $1 ORDER BY orden`,
      [id]
    );

    return res.json({ item: { ...ev, preguntas } });
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
    const { rows: evRows } = await query(`SELECT id, id_type, id_course FROM evaluation WHERE id = $1 LIMIT 1`, [id]);
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (!examenTypeIds.includes(ev.id_type))
      return res.status(400).json({ error: "Esta evaluación no es de tipo Examen" });

    if (ev.id_course) {
      try { await requireAnioVigenteForCourse(ev.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    // Actualizar datos del examen en evaluation, incluyendo el profesor asignado
    await query(
      `UPDATE evaluation SET tiempo_minutos = $1, percent = $2, id_teacher = $3, title = $4 WHERE id = $5`,
      [tiempo_minutos, percent, id_teacher, title, id]
    );

    // Reemplazar preguntas: delete + insert
    await query(`DELETE FROM examen_detalle WHERE id_evaluation = $1`, [id]);

    const values = [];
    const placeholders = preguntas.map((p, idx) => {
      const base = idx * 7;
      values.push(
        id,
        idx + 1,
        p.tipo,
        cleanStr(p.enunciado),
        Number(p.puntos),
        JSON.stringify(p.opciones),
        JSON.stringify(p.respuesta_correcta)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    try {
      await query(
        `INSERT INTO examen_detalle (id_evaluation, orden, tipo, enunciado, puntos, opciones, respuesta_correcta)
         VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (insErr) {
      return res.status(500).json({ error: `Error actualizando preguntas: ${insErr.message}` });
    }

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
    let sql = `
      SELECT ep.id, ep.year, ep.fecha_ini, ep.fecha_fin, ep.fecha_limite_ver, ep.habilitado, ep.created_at,
             ep.id_evaluation, ep.id_course,
             ev.id AS ev_id, ev.title AS ev_title, ev.percent AS ev_percent, ev.tiempo_minutos AS ev_tiempo_minutos,
             ev.id_module AS ev_id_module, ev.id_group AS ev_id_group, ev.id_class AS ev_id_class,
             m.id AS mod_id, m.name AS mod_name,
             g.id AS grp_id, g.name AS grp_name,
             cl.id AS class_id, cl.name AS class_name,
             co.id AS course_id, co.name AS course_name, co.year AS course_year, co.level AS course_level
      FROM examen_programacion ep
      LEFT JOIN evaluation ev ON ev.id = ep.id_evaluation
      LEFT JOIN module m ON m.id = ev.id_module
      LEFT JOIN "group" g ON g.id = ev.id_group
      LEFT JOIN class cl ON cl.id = ev.id_class
      LEFT JOIN course co ON co.id = ep.id_course
      WHERE 1=1
    `;
    const params = [];
    if (req.query.id_evaluation) { params.push(toInt(req.query.id_evaluation)); sql += ` AND ep.id_evaluation = $${params.length}`; }
    if (req.query.id_course)     { params.push(toInt(req.query.id_course));     sql += ` AND ep.id_course = $${params.length}`; }
    if (req.query.habilitado !== undefined) {
      params.push(req.query.habilitado === "true"); sql += ` AND ep.habilitado = $${params.length}`;
    }
    sql += ` ORDER BY ep.created_at DESC`;

    const { rows } = await query(sql, params);

    const items = rows.map((r) => ({
      id: r.id, year: r.year, fecha_ini: r.fecha_ini, fecha_fin: r.fecha_fin,
      fecha_limite_ver: r.fecha_limite_ver, habilitado: r.habilitado, created_at: r.created_at,
      id_evaluation: r.id_evaluation, id_course: r.id_course,
      evaluation: r.ev_id ? {
        id: r.ev_id, title: r.ev_title, percent: r.ev_percent, tiempo_minutos: r.ev_tiempo_minutos,
        id_module: r.ev_id_module, id_group: r.ev_id_group, id_class: r.ev_id_class,
        module: r.mod_id ? { id: r.mod_id, name: r.mod_name } : null,
        group: r.grp_id ? { id: r.grp_id, name: r.grp_name } : null,
        class: r.class_id ? { id: r.class_id, name: r.class_name } : null,
      } : null,
      course: r.course_id ? { id: r.course_id, name: r.course_name, year: r.course_year, level: r.course_level } : null,
    }));

    return res.json({ items });
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
    const { rows: evRows } = await query(`SELECT id, id_type FROM evaluation WHERE id = $1 LIMIT 1`, [id_evaluation]);
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (ev.id_type !== examenTypeId)
      return res.status(400).json({ error: "La evaluación no es de tipo Examen" });

    // Verificar que el curso exista
    const { rows: courseRows } = await query(`SELECT id FROM course WHERE id = $1 LIMIT 1`, [id_course]);
    if (!courseRows[0]?.id) return res.status(404).json({ error: "Curso no existe" });

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const { rows } = await query(
      `INSERT INTO examen_programacion (id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado, created_at`,
      [id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado]
    );

    return res.status(201).json({ ok: true, item: rows[0] });
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

    const { rows: progRows } = await query(`SELECT id, id_course FROM examen_programacion WHERE id = $1 LIMIT 1`, [id]);
    const prog = progRows[0];
    if (!prog?.id) return res.status(404).json({ error: "Programación no existe" });

    if (prog.id_course) {
      try { await requireAnioVigenteForCourse(prog.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    const fields = [];
    const params = [];
    if (req.body?.fecha_ini !== undefined) { params.push(req.body.fecha_ini || null); fields.push(`fecha_ini = $${params.length}`); }
    if (req.body?.fecha_fin !== undefined) { params.push(req.body.fecha_fin || null); fields.push(`fecha_fin = $${params.length}`); }
    if (req.body?.fecha_limite_ver !== undefined) { params.push(req.body.fecha_limite_ver || null); fields.push(`fecha_limite_ver = $${params.length}`); }
    if (req.body?.habilitado !== undefined) { params.push(Boolean(req.body.habilitado)); fields.push(`habilitado = $${params.length}`); }

    if (fields.length === 0)
      return res.status(400).json({ error: "No hay campos para actualizar" });

    params.push(id);
    const { rows } = await query(
      `UPDATE examen_programacion SET ${fields.join(", ")} WHERE id = $${params.length}
       RETURNING id, id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado`,
      params
    );

    return res.json({ ok: true, item: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando programación" });
  }
});

// DELETE /api/admin/exam-schedules/:id
adminRouter.delete("/exam-schedules/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { rows: progRows } = await query(`SELECT id_course FROM examen_programacion WHERE id = $1 LIMIT 1`, [id]);
    const prog = progRows[0];
    if (!prog) return res.status(404).json({ error: "Programación no existe" });

    if (prog.id_course) {
      try { await requireAnioVigenteForCourse(prog.id_course); }
      catch (err) { return handleYearError(res, err); }
    }

    // Desreferenciar rta_examen antes de eliminar
    await query(`UPDATE rta_examen SET id_programacion = NULL WHERE id_programacion = $1`, [id]);

    await query(`DELETE FROM examen_programacion WHERE id = $1`, [id]);

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

    const [{ rows: rtas }, { rows: gradesRows }, { rows: users }] = await Promise.all([
      query(
        `SELECT id_student, calificacion, finalizado_at FROM rta_examen
         WHERE id_evaluation = $1 AND finalizado_at IS NOT NULL`,
        [id_evaluation]
      ),
      query(
        `SELECT id_student, grade, attempts, finished_at FROM grades
         WHERE id_exam = $1 AND finished_at IS NOT NULL`,
        [id_evaluation]
      ),
      query(`SELECT id, name, cedula FROM users WHERE id_course = $1 AND estado = 'Activo'`, [id_course]),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));

    const itemsMap = new Map();

    for (const r of rtas) {
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

    for (const g of gradesRows) {
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

    const { rows: evRows } = await query(`SELECT id_course FROM evaluation WHERE id = $1 LIMIT 1`, [id_evaluation]);
    const ev = evRows[0];
    if (!ev) return res.status(404).json({ error: "Evaluación no encontrada" });

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    await query(`DELETE FROM rta_examen WHERE id_student = $1 AND id_evaluation = $2`, [id_student, id_evaluation]);
    await query(`DELETE FROM grades WHERE id_student = $1 AND id_exam = $2`, [id_student, id_evaluation]);

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
    const { rows } = await query(
      `SELECT year, nombre, activo, created_at FROM anio_lectivo ORDER BY year DESC`
    );
    return res.json({ items: rows });
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

    try {
      const { rows } = await query(
        `INSERT INTO anio_lectivo (year, nombre, activo) VALUES ($1, $2, false) RETURNING year, nombre, activo`,
        [year, nombre]
      );
      return res.status(201).json({ ok: true, item: rows[0] });
    } catch (error) {
      if (isUniqueViolation(error))
        return res.status(409).json({ error: `El año ${year} ya existe` });
      return res.status(500).json({ error: error.message });
    }
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
    const { rows: existsRows } = await query(`SELECT year FROM anio_lectivo WHERE year = $1 LIMIT 1`, [year]);
    if (!existsRows[0]) return res.status(404).json({ error: `Año ${year} no encontrado` });

    // Desactivar todos los años
    await query(`UPDATE anio_lectivo SET activo = false WHERE year != $1`, [year]);

    // Activar el año solicitado
    const { rows } = await query(
      `UPDATE anio_lectivo SET activo = true WHERE year = $1 RETURNING year, nombre, activo`,
      [year]
    );

    // Invalidar caché para que el siguiente request use el año nuevo
    invalidarCacheAnioLectivo();

    return res.json({ ok: true, item: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error activando año lectivo" });
  }
});

// ============================================================================
// DELETE /api/admin/delete-user?cedula=XXX
// Elimina usuario de auth (cascada a public.users y todas las tablas relacionadas)
//
// NOTA DE MIGRACIÓN: duplicado del handler `/delete-user` de más arriba (Express
// solo llega a usar el primero registrado; este queda inalcanzable, igual que en
// el original). Se deja igual para no alterar comportamiento existente.
// ============================================================================
adminRouter.delete("/delete-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    const cedula = cleanStr(req.query?.cedula);
    if (!cedula) return res.status(400).json({ error: "cedula requerida" });

    const { rows: uRows } = await query(`SELECT id, name, email FROM users WHERE cedula = $1 LIMIT 1`, [cedula]);
    const u = uRows[0];
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado" });

    try {
      await deleteAuthUser(u.id);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error eliminando usuario" });
  }
});
