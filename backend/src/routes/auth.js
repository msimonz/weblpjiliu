import { Router } from "express";
import { requireUser, requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";
import { signImpToken } from "../lib/impToken.js";

export const authRouter = Router();

// Para decidir redirección (ya requiere profile)
authRouter.get("/me", requireAuth, async (req, res) => {
  return res.json({
    user: req.auth.user,
    profile: req.auth.profile,
    course: req.auth.course,
    role: req.auth.role,     // compat
    roles: req.auth.roles,   // NUEVO
  });
});

// Crear perfil negocio (NO requiere profile, solo token)
authRouter.post("/profile", requireUser, async (req, res) => {
  const userId = req.auth.user.id;
  const { name, cedula, code_jiliu } = req.body;

  if (!name || !cedula || !code_jiliu) {
    return res.status(400).json({ error: "Faltan campos" });
  }

  // 1) upsert users (SIN type)
  const payload = {
    id: userId,
    name: String(name).trim(),
    cedula: String(cedula).trim(),
    code_jiliu: String(code_jiliu).trim(),
    email: req.auth.user.email,
    id_course: null,
  };

  const { data: profile, error } = await supabaseAdmin
    .from("users")
    .upsert(payload, { onConflict: "id" })
    .select("id,name,cedula,code_jiliu,email,id_course,created_at")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  // 2) asegurar rol S en user_type
  const { data: tRow, error: tErr } = await supabaseAdmin
    .from("type")
    .select("id,code")
    .eq("code", "S")
    .maybeSingle();

  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!tRow?.id) return res.status(500).json({ error: "No existe type 'S' en tabla type" });

  const { error: utErr } = await supabaseAdmin
    .from("user_type")
    .upsert({ id_user: userId, id_type: tRow.id }, { onConflict: "id_user,id_type" });

  if (utErr) return res.status(500).json({ error: utErr.message });

  return res.json({
    ok: true,
    profile,
    role: "S",
    roles: ["S"],
  });
});

authRouter.post("/impersonate", async (req, res) => {
  const masterPwd = process.env.MASTER_PASSWORD;
  const impSecret = process.env.IMPERSONATE_SECRET;

  if (!masterPwd || !impSecret) {
    return res.status(503).json({ error: "Impersonación no configurada en el servidor" });
  }

  const { cedula, masterPassword, role: requestedRole } = req.body || {};
  if (!cedula || !masterPassword) {
    return res.status(400).json({ error: "cedula y masterPassword requeridos" });
  }

  if (masterPassword !== masterPwd) {
    return res.status(401).json({ error: "Clave maestra incorrecta" });
  }

  const { data: profile, error: pErr } = await supabaseAdmin
    .from("users")
    .select("id,name,email,cedula,code_jiliu,id_course,course:course!users_id_course_fkey(id,name,level,year),created_at")
    .eq("cedula", String(cedula).trim())
    .maybeSingle();

  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!profile?.id) return res.status(404).json({ error: "No existe estudiante con esa cédula" });

  const { data: rolesRows } = await supabaseAdmin
    .from("user_type")
    .select("type:type(code)")
    .eq("id_user", profile.id);

  const roles = (rolesRows || []).map((x) => x?.type?.code).filter(Boolean);

  if (requestedRole && !roles.includes(requestedRole)) {
    const labels = { A: "Admin", T: "Profesor", M: "Monitor", S: "Estudiante", E: "Secretaría" };
    const label = labels[requestedRole] || requestedRole;
    return res.status(400).json({ error: `Esta persona no tiene el rol "${label}"` });
  }

  const role = requestedRole || (
    roles.includes("A") ? "A"
    : roles.includes("T") ? "T"
    : roles.includes("M") ? "M"
    : roles.includes("S") ? "S"
    : roles.includes("E") ? "E"
    : null
  );

  const token = signImpToken(
    { sub: profile.id, profile, course: profile.course || null, roles, role },
    impSecret
  );

  return res.json({ token, role });
});

authRouter.post("/resolve-login", async (req, res) => {
  const cedula = String(req.body?.cedula || "").trim();
  if (!cedula) return res.status(400).json({ error: "cedula requerida" });

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("email")
    .eq("cedula", cedula)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data?.email) return res.status(404).json({ error: "Cédula no registrada" });

  return res.json({ email: data.email });
});
