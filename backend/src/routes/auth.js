import { Router } from "express";
import { requireUser, requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const authRouter = Router();

// Para decidir redirección (ya requiere profile)
authRouter.get("/me", requireAuth, async (req, res) => {
  return res.json({
    user: req.auth.user,
    profile: req.auth.profile,
    role: req.auth.role,
  });
});

// Crear perfil negocio (NO requiere profile, solo token)
authRouter.post("/profile", requireUser, async (req, res) => {
  const userId = req.auth.user.id;

  const { name, cedula, code_jiliu } = req.body;

  if (!name || !cedula || !code_jiliu) {
    return res.status(400).json({ error: "Faltan campos" });
  }

  const payload = {
    id: userId,
    type: "S",              // ✅ IMPORTANTE: evita el NOT NULL
    name: String(name).trim(),
    cedula: String(cedula).trim(),
    code_jiliu: String(code_jiliu).trim(),
    email: req.auth.user.email,
    id_course: null,        // ✅ como dijiste, queda null por ahora
  };

  const { data, error } = await supabaseAdmin
    .from("users")
    .upsert(payload, { onConflict: "id" })
    .select("id,type,name,cedula,code_jiliu,email,id_course")
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, profile: data });
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