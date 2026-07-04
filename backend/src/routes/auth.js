import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { requireUser, requireAuth } from "../middlewares/auth.js";
import { query } from "../db.js";
import { signImpToken } from "../lib/impToken.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";

export const authRouter = Router();

// POST /auth/login — reemplaza supabase.auth.signInWithPassword.
// Verifica el hash bcrypt migrado desde Supabase Auth (auth.users.encrypted_password)
// y emite un JWT propio.
authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "email y password requeridos" });
  }

  const { rows } = await query(
    `SELECT id, email, encrypted_password, banned_until
     FROM auth.users
     WHERE email = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [email]
  );
  const authUser = rows[0];

  // Mismo mensaje genérico tanto si el usuario no existe como si la clave es incorrecta,
  // para no revelar qué emails están registrados.
  if (!authUser?.encrypted_password) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  if (authUser.banned_until && new Date(authUser.banned_until) > new Date()) {
    return res.status(403).json({ error: "Usuario bloqueado" });
  }

  const valid = await bcrypt.compare(password, authUser.encrypted_password);
  if (!valid) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  const token = jwt.sign(
    { sub: authUser.id, email: authUser.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

  return res.json({ token, user: { id: authUser.id, email: authUser.email } });
});

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
  const { rows: profileRows } = await query(
    `INSERT INTO users (id, name, cedula, code_jiliu, email, id_course)
     VALUES ($1, $2, $3, $4, $5, NULL)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, cedula = EXCLUDED.cedula, code_jiliu = EXCLUDED.code_jiliu,
       email = EXCLUDED.email, id_course = EXCLUDED.id_course
     RETURNING id, name, cedula, code_jiliu, email, id_course, created_at`,
    [userId, String(name).trim(), String(cedula).trim(), String(code_jiliu).trim(), req.auth.user.email]
  );
  const profile = profileRows[0];

  // 2) asegurar rol S en user_type
  const { rows: tRows } = await query(`SELECT id, code FROM type WHERE code = $1 LIMIT 1`, ["S"]);
  if (!tRows[0]?.id) return res.status(500).json({ error: "No existe type 'S' en tabla type" });

  await query(
    `INSERT INTO user_type (id_user, id_type) VALUES ($1, $2) ON CONFLICT (id_user, id_type) DO NOTHING`,
    [userId, tRows[0].id]
  );

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

  const { rows: profileRows } = await query(
    `SELECT u.id, u.name, u.email, u.cedula, u.code_jiliu, u.id_course, u.created_at,
            c.id AS course_id, c.name AS course_name, c.level AS course_level, c.year AS course_year
     FROM users u
     LEFT JOIN course c ON c.id = u.id_course
     WHERE u.cedula = $1 LIMIT 1`,
    [String(cedula).trim()]
  );
  const row = profileRows[0];
  if (!row?.id) return res.status(404).json({ error: "No existe estudiante con esa cédula" });

  const profile = {
    id: row.id, name: row.name, email: row.email, cedula: row.cedula,
    code_jiliu: row.code_jiliu, id_course: row.id_course, created_at: row.created_at,
    course: row.course_id ? { id: row.course_id, name: row.course_name, level: row.course_level, year: row.course_year } : null,
  };

  const { rows: rolesRows } = await query(
    `SELECT t.code FROM user_type ut JOIN type t ON t.id = ut.id_type WHERE ut.id_user = $1`,
    [profile.id]
  );

  const roles = rolesRows.map((x) => x.code).filter(Boolean);

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

  const { rows } = await query(`SELECT email FROM users WHERE cedula = $1 LIMIT 1`, [cedula]);
  if (!rows[0]?.email) return res.status(404).json({ error: "Cédula no registrada" });

  return res.json({ email: rows[0].email });
});

// POST /auth/forgot-password — reemplaza supabase.auth.resetPasswordForEmail.
// Genera un token de un solo uso (30 min) y envía el link por correo.
// Responde igual exista o no el email, para no revelar qué correos están registrados.
authRouter.post("/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "email inválido" });
  }

  const { rows } = await query(
    `SELECT id, email FROM auth.users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
    [email]
  );
  const user = rows[0];

  if (user) {
    const { rows: tokenRows } = await query(
      `INSERT INTO password_reset_tokens (id_user, expires_at)
       VALUES ($1, now() + interval '30 minutes')
       RETURNING token`,
      [user.id]
    );
    const token = tokenRows[0].token;

    const resetLink = `${process.env.FRONTEND_URL}/update-password?token=${token}`;

    try {
      await sendPasswordResetEmail(user.email, resetLink);
    } catch (e) {
      console.error("[forgot-password] Error enviando correo:", e.message);
      return res.status(500).json({ error: "No se pudo enviar el correo. Intenta más tarde." });
    }
  }

  return res.json({ ok: true, message: "Si el correo existe, te enviamos un link para restablecer tu contraseña." });
});

// POST /auth/reset-password — reemplaza supabase.auth.updateUser({ password }) tras el link mágico.
// Verifica el token de un solo uso y actualiza encrypted_password.
authRouter.post("/reset-password", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");

  if (!token) return res.status(400).json({ error: "token requerido" });
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }

  const { rows } = await query(
    `SELECT token, id_user, expires_at, used_at FROM password_reset_tokens WHERE token = $1 LIMIT 1`,
    [token]
  );
  const resetRow = rows[0];

  if (!resetRow) return res.status(400).json({ error: "El link no es válido o expiró" });
  if (resetRow.used_at) return res.status(400).json({ error: "Este link ya fue usado" });
  if (new Date(resetRow.expires_at) < new Date()) {
    return res.status(400).json({ error: "El link no es válido o expiró" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  await query(
    `UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2`,
    [passwordHash, resetRow.id_user]
  );

  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE token = $1`, [token]);

  return res.json({ ok: true, message: "Contraseña actualizada correctamente." });
});
