import { Router } from "express";
import { requireUser, requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const authRouter = Router();

// Para decidir redirección (ya requiere profile)
authRouter.get("/me", requireAuth, async (req, res) => {
  return res.json({
    user: req.auth.user,
    profile: req.auth.profile,
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
    .single();

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
