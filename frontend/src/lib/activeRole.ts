import { getRoles, RoleCode } from "@/lib/roles";

export function getActiveRole(me: Record<string, unknown>): RoleCode {
  const roles = getRoles(me);

  const active = (typeof window !== "undefined"
    ? (sessionStorage.getItem("active_role") as RoleCode | null)
    : null);

  // si active existe y el usuario lo tiene, úsalo
  if (active && roles.includes(active)) return active;

  // fallback: prioridad A > T > M > S > E
  if (roles.includes("A")) return "A";
  if (roles.includes("T")) return "T";
  if (roles.includes("M")) return "M";
  if (roles.includes("S")) return "S";
  if (roles.includes("E")) return "E";
  return "S";
}

export function roleToRoute(role: RoleCode) {
  if (role === "A") return "/admin";
  if (role === "T") return "/teacher";
  if (role === "M") return "/monitor";
  if (role === "E") return "/secretaria";
  return "/dashboard";
}
