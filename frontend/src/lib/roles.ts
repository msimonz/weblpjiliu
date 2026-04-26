export type RoleCode = "A" | "T" | "M" | "S" | "E";

export function getRoles(me: Record<string, unknown>): RoleCode[] {
  const r = me?.roles;
  if (Array.isArray(r) && r.length) return r as RoleCode[];

  const single = me?.role;
  if (single === "A" || single === "T" || single === "M" || single === "S" || single === "E") return [single];

  return [];
}

export function primaryRole(me: Record<string, unknown>): RoleCode | null {
  const roles = getRoles(me);
  if (roles.includes("A")) return "A";
  if (roles.includes("T")) return "T";
  if (roles.includes("M")) return "M";
  if (roles.includes("S")) return "S";
  if (roles.includes("E")) return "E";
  return null;
}

export function roleLabelFromRole(role: RoleCode | null) {
  if (role === "A") return "Admin";
  if (role === "T") return "Profesor";
  if (role === "M") return "Monitor";
  if (role === "S") return "Estudiante";
  if (role === "E") return "Secretaría";
  return "—";
}
