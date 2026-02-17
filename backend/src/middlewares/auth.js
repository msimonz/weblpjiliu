import { supabaseAdmin } from "../supabase.js";

// ===============
// Helper: cargar profile + roles
// ===============
async function loadProfileAndRoles(user) {
  // profile (sin type)
  const { data: profile, error: pErr } = await supabaseAdmin
    .from("users")
    .select("id,name,email,cedula,code_jiliu,id_course,created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);

  // roles por tabla puente
  const { data: rolesRows, error: rErr } = await supabaseAdmin
    .from("user_type")
    .select("type: type(code)")
    .eq("id_user", user.id);

  if (rErr) throw new Error(rErr.message);

  const roles = (rolesRows || [])
    .map((x) => x?.type?.code)
    .filter(Boolean);

  // role principal para compatibilidad (A > T > S)
  const role = roles.includes("A")
    ? "A"
    : roles.includes("T")
    ? "T"
    : roles.includes("S")
    ? "S"
    : null;

  return { profile: profile || null, roles, role };
}

// ===============
// Middleware opcional (no bloquea)
// ===============
export async function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    req.auth = null;
    if (!token) return next();

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return next();

    const user = data.user;
    const { profile, roles, role } = await loadProfileAndRoles(user);

    req.auth = { user, profile, roles, role };
    return next();
  } catch (e) {
    // si falla, no bloquea (solo deja req.auth null)
    req.auth = null;
    return next();
  }
}

// ✅ Solo exige token válido (sirve para /profile en registro)
export function requireUser(req, res, next) {
  if (!req.auth?.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ✅ Exige token válido + fila en public.users (para usar la app)
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No token" });

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Token inválido" });

    const user = data.user;

    const { profile, roles, role } = await loadProfileAndRoles(user);
    if (!profile) return res.status(401).json({ error: "Profile no existe" });

    req.auth = { user, profile, roles, role };
    return next();
  } catch (e) {
    return res.status(401).json({ error: e?.message || "No autorizado" });
  }
}

// ✅ Requiere que tenga al menos uno de los roles pedidos
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth?.user) return res.status(401).json({ error: "Unauthorized" });
    const roles = req.auth.roles || [];
    const ok = allowedRoles.some((r) => roles.includes(r));
    if (!ok) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
