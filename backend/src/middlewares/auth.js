import { supabaseAdmin } from "../supabase.js";

// ===============
// Helper: cargar profile + roles
// ===============
async function loadProfileAndRoles(user) {
  const { data: profile, error: pErr } = await supabaseAdmin
    .from("users")
    .select(
      "id,name,email,cedula,code_jiliu,id_course,course:course!users_id_course_fkey(id,name,level,year),created_at"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);

  const { data: rolesRows, error: rErr } = await supabaseAdmin
    .from("user_type")
    .select("type:type(code)")
    .eq("id_user", user.id);

  if (rErr) throw new Error(rErr.message);

  const roles = (rolesRows || [])
    .map((x) => x?.type?.code)
    .filter(Boolean);

  const role = roles.includes("A")
    ? "A"
    : roles.includes("T")
    ? "T"
    : roles.includes("M")
    ? "M"
    : roles.includes("S")
    ? "S"
    : roles.includes("E")
    ? "E"
    : null;

  return {
    profile: profile || null,
    course: profile?.course || null,
    roles,
    role,
  };
}

function extractBearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function validateTokenAndLoadContext(token) {
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    return { ok: false, error: "Token inválido o expirado" };
  }

  const user = data.user;
  const { profile, course, roles, role } = await loadProfileAndRoles(user);

  return {
    ok: true,
    auth: { user, profile, course, roles, role },
  };
}

// ===============
// Middleware opcional (no bloquea)
// ===============
export async function authMiddleware(req, res, next) {
  try {
    req.auth = null;

    const token = extractBearerToken(req);
    if (!token) return next();

    const result = await validateTokenAndLoadContext(token);
    if (!result.ok) return next();

    req.auth = result.auth;
    return next();
  } catch {
    req.auth = null;
    return next();
  }
}

// ✅ Solo exige token válido (sirve para /profile en registro)
export async function requireUser(req, res, next) {
  try {
    if (req.auth?.user) return next();

    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "No autorizado" });

    const result = await validateTokenAndLoadContext(token);
    if (!result.ok) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }

    req.auth = result.auth;
    return next();
  } catch (e) {
    return res.status(401).json({ error: e?.message || "No autorizado" });
  }
}

// ✅ Exige token válido + fila en public.users (para usar la app)
export async function requireAuth(req, res, next) {
  try {
    if (req.auth?.user) {
      if (!req.auth?.profile) {
        return res.status(401).json({ error: "Profile no existe" });
      }
      return next();
    }

    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "No token" });

    const result = await validateTokenAndLoadContext(token);
    if (!result.ok) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }

    if (!result.auth?.profile) {
      return res.status(401).json({ error: "Profile no existe" });
    }

    req.auth = result.auth;
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
    return next();
  };
}