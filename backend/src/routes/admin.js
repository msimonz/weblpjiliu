import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
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
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB
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

  // 1) desired type ids
  const desiredTypeIds = [];
  for (const c of codes) desiredTypeIds.push(await getTypeIdByCode(c));

  // 2) current type ids
  const { data: current, error: curErr } = await supabaseAdmin
    .from("user_type")
    .select("id_type")
    .eq("id_user", id_user);

  if (curErr) throw new Error(curErr.message);

  const curSet = new Set((current || []).map((r) => r.id_type));
  const desSet = new Set(desiredTypeIds);

  // 3) delete extra roles
  const toDelete = [...curSet].filter((x) => !desSet.has(x));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("user_type")
      .delete()
      .eq("id_user", id_user)
      .in("id_type", toDelete);

    if (delErr) throw new Error(delErr.message);
  }

  // 4) ensure desired roles
  for (const id_type of desiredTypeIds) {
    const { error: upErr } = await supabaseAdmin
      .from("user_type")
      .upsert({ id_user, id_type }, { onConflict: "id_user,id_type" });

    if (upErr) throw new Error(upErr.message);
  }
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
  const year = req.body?.year;

  if (!name) return res.status(400).json({ error: "name requerido" });
  if (!level || level < 1 || level > 4)
    return res.status(400).json({ error: "level inválido (1..4)" });

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
// 2) CLASSES
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
  if (!level || level < 1 || level > 4)
    return res.status(400).json({ error: "level inválido (1..4)" });

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

  const ids = (ut || []).map((r) => r.id_user);
  if (ids.length === 0) return res.json({ items: [] });

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
// 7) SUBIR EXCEL: crear/actualizar users
// (Lo dejo igual a como lo tienes; solo mantengo tu lógica)
// ============================================================================
adminRouter.post("/upload-users", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file requerido (xlsx)" });

    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: "El Excel no tiene hojas" });

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

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
      const rowNum = i + 2;

      const email = cleanStr(r.email || r.Email || r.EMAIL).toLowerCase();
      const name = cleanStr(r.name || r.Name || r.NOMBRE);

      const typeRaw = cleanStr(r.type || r.Type || r.ROL).toUpperCase();
      const typeList = typeRaw.split(",").map((x) => x.trim()).filter(Boolean);

      const cedula = cleanStr(r.cedula || r.Cedula || r.CEDULA);
      const code_jiliu = cleanStr(r.code_jiliu || r.Code || r.CODIGO || r.CODE_JILIU);
      const id_course = toInt(r.id_course || r.ID_COURSE || r.course_id || r.COURSE_ID);

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
      if (typeList.length === 0 || typeList.some((t) => !["S", "T", "A"].includes(t))) {
        results.errors.push({ row: rowNum, error: "type inválido (S/T/A o lista S,T)" });
        results.skipped++;
        continue;
      }
      if (!cedula) {
        results.errors.push({ row: rowNum, error: "cedula requerida" });
        results.skipped++;
        continue;
      }
      if (!code_jiliu) {
        results.errors.push({ row: rowNum, error: "code_jiliu requerido" });
        results.skipped++;
        continue;
      }
      if (!id_course) {
        results.errors.push({ row: rowNum, error: "id_course requerido" });
        results.skipped++;
        continue;
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

      const { error: histErr } = await supabaseAdmin
        .from("user_history")
        .upsert({ id_student: authUserId, id_course }, { onConflict: "id_student,id_course" });

      if (histErr) {
        results.errors.push({ row: rowNum, error: `history: ${histErr.message}` });
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
// 8) CREAR USUARIO MANUAL (igual al tuyo)
// ============================================================================
adminRouter.post("/create-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = cleanStr(req.body?.email).toLowerCase();
    const name = cleanStr(req.body?.name);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
    const cedula = cleanStr(req.body?.cedula);
    const code_jiliu = cleanStr(req.body?.code_jiliu);
    const id_course = toInt(req.body?.id_course);

    if (!email || !email.includes("@")) return res.status(400).json({ error: "email inválido" });
    if (!name) return res.status(400).json({ error: "name requerido" });

    if (roles.length === 0 || roles.some((r) => !["S", "T", "A"].includes(String(r).toUpperCase()))) {
      return res.status(400).json({ error: "roles inválidos (S/T/A)" });
    }
    const roleList = roles.map((r) => String(r).toUpperCase());

    if (!cedula) return res.status(400).json({ error: "cedula requerida" });
    if (!code_jiliu) return res.status(400).json({ error: "code_jiliu requerido" });
    if (!id_course) return res.status(400).json({ error: "id_course requerido" });

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
      if (!existing?.id)
        return res.status(400).json({
          error: (createRes.error.message || "No se pudo crear") + " (y no existe en public.users)",
        });

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

    const { error: histErr } = await supabaseAdmin
      .from("user_history")
      .upsert({ id_student: authUserId, id_course }, { onConflict: "id_student,id_course" });

    if (histErr) {
      return res.json({ ok: true, item: up, warn: `history: ${histErr.message}`, created: !createRes?.error });
    }

    return res.json({ ok: true, item: up, created: !createRes?.error });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando usuario" });
  }
});

// ============================================================================
// 9) ✅ ACTUALIZAR USUARIO POR CÉDULA (ARREGLADO)
//  - PRIMERO actualiza email en Auth (si cambió)
//  - LUEGO actualiza public.users
//  - valida email y code_jiliu únicos para mensaje humano
// ============================================================================
adminRouter.post("/update-user-by-cedula", requireAuth, requireAdmin, async (req, res) => {
  try {
    const cedula = cleanStr(req.body?.cedula);
    const email = cleanStr(req.body?.email).toLowerCase();
    const name = cleanStr(req.body?.name);
    const code_jiliu = cleanStr(req.body?.code_jiliu);
    const id_course = toInt(req.body?.id_course);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];

    if (!cedula) return res.status(400).json({ error: "cedula requerida" });
    if (!email || !email.includes("@")) return res.status(400).json({ error: "email inválido" });
    if (!name) return res.status(400).json({ error: "name requerido" });
    if (!code_jiliu) return res.status(400).json({ error: "code_jiliu requerido" });
    if (!id_course) return res.status(400).json({ error: "id_course requerido" });

    if (roles.length === 0 || roles.some((r) => !["S", "T", "A"].includes(String(r).toUpperCase()))) {
      return res.status(400).json({ error: "roles inválidos (S/T/A)" });
    }
    const roleList = roles.map((r) => String(r).toUpperCase());

    // 1) buscar usuario por cedula
    const { data: u, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id,cedula,email")
      .eq("cedula", cedula)
      .maybeSingle();

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!u?.id) return res.status(404).json({ error: "Usuario no encontrado con esa cédula" });

    const userId = u.id;
    const oldEmail = (u.email || "").toLowerCase();

    // 2) Validar code_jiliu único (mensaje humano)
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

    // 3) Validar email único en tu tabla (opcional pero útil)
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

    // 4) ✅ Actualizar Auth (siempre actualiza metadata; email solo si cambió)
    //    IMPORTANTE: si Auth falla, NO tocamos la DB (evita desincronización).
    let warn = null;

    const authPayload = {
      user_metadata: { name, roles: roleList },
    };

    // si cambió el email, lo cambiamos en Auth
    if (email !== oldEmail) {
      authPayload.email = email;
      authPayload.email_confirm = true; // evita quedar "unconfirmed"
    }

    const authUpd = await supabaseAdmin.auth.admin.updateUserById(userId, authPayload);

    if (authUpd?.error) {
      // fallo Auth => corta aquí
      const msg = authUpd.error.message || "No se pudo actualizar el email en Auth";
      return res.status(400).json({ error: `Auth: ${msg}` });
    }

    // 5) Actualizar public.users (ya con Auth OK)
    const { data: up, error: upErr } = await supabaseAdmin
      .from("users")
      .update({ email, name, code_jiliu, id_course })
      .eq("id", userId)
      .select("id,email,name,cedula,code_jiliu,id_course")
      .maybeSingle();

    if (upErr) {
      // si es unique, lo damos humano
      if (isUniqueViolation(upErr)) {
        return res.status(409).json({ error: "Conflicto: email o code_jiliu ya existen." });
      }
      return res.status(500).json({ error: upErr.message });
    }

    // 6) roles en user_type (reemplazo total)
    await replaceUserRoles(userId, roleList);

    // 7) history siempre
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
// GET /api/admin/user-by-cedula?cedula=...
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
