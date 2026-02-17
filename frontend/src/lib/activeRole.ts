import { getRoles, RoleCode } from "@/lib/roles";

export function getActiveRole(me: any): RoleCode {
  const roles = getRoles(me);

  const active = (typeof window !== "undefined"
    ? (localStorage.getItem("active_role") as RoleCode | null)
    : null);

  // si active existe y el usuario lo tiene, úsalo
  if (active && roles.includes(active)) return active;

  // fallback: prioridad A > T > S
  if (roles.includes("A")) return "A";
  if (roles.includes("T")) return "T";
  return "S";
}

export function roleToRoute(role: RoleCode) {
  if (role === "A") return "/admin";
  if (role === "T") return "/teacher";
  return "/dashboard";
}
