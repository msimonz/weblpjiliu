import { supabaseAdmin } from "../supabase.js";

export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  req.auth = null;

  if (!token) return next();

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  console.log("[AUTH] token head:", token?.slice(0, 18));
  console.log("[AUTH] getUser error:", error?.message);
  console.log("[AUTH] user id:", data?.user?.id);

  if (error || !data?.user) return next();

  // OJO: profile puede NO existir todavía (registro nuevo)
  const { data: profile, error: profErr } = await supabaseAdmin
    .from("users")
    .select("id,type,id_course,email,name,code_jiliu,cedula")
    .eq("id", data.user.id)
    .maybeSingle();

  console.log("[AUTH] profile exists?:", !!profile, "profErr:", profErr?.message);

  req.auth = {
    user: data.user,
    profile: profile || null,
    role: profile?.type || null,
  };

  next();
}

// ✅ Solo exige token válido (sirve para /profile en registro)
export function requireUser(req, res, next) {
  if (!req.auth?.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ✅ Exige token válido + fila en public.users (para usar la app)
export function requireAuth(req, res, next) {
  if (!req.auth?.profile) return res.status(401).json({ error: "Unauthorized" });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth?.profile) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
