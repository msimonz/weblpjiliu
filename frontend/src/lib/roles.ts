export type RoleCode = "A" | "T" | "S";

export function getRoles(me: any): RoleCode[] {
  const r = me?.roles;
  if (Array.isArray(r) && r.length) return r as RoleCode[];

  const single = me?.role;
  if (single === "A" || single === "T" || single === "S") return [single];

  return [];
}

export function primaryRole(me: any): RoleCode | null {
  const roles = getRoles(me);
  if (roles.includes("A")) return "A";
  if (roles.includes("T")) return "T";
  if (roles.includes("S")) return "S";
  return null;
}

export function roleLabelFromRole(role: RoleCode | null) {
  if (role === "A") return "Admin";
  if (role === "T") return "Teacher";
  if (role === "S") return "Student";
  return "—";
}
