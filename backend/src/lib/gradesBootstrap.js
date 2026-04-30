import { supabaseAdmin } from "../supabase.js";

const STUDENT_ROLE_CODES = ["S", "M"];
const INSERT_CHUNK_SIZE = 500;

async function getStudentRoleIds() {
  const { data, error } = await supabaseAdmin
    .from("type")
    .select("id,code")
    .in("code", STUDENT_ROLE_CODES);

  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.id).filter(Boolean);
}

async function getCourseStudentIds(id_course) {
  const courseId = Number(id_course || 0);
  if (!courseId) return [];

  const { data: users, error: usersErr } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id_course", courseId);

  if (usersErr) throw new Error(usersErr.message);

  const userIds = (users || []).map((u) => u.id).filter(Boolean);
  if (userIds.length === 0) return [];

  const roleIds = await getStudentRoleIds();
  if (roleIds.length === 0) return [];

  const { data: roleRows, error: roleErr } = await supabaseAdmin
    .from("user_type")
    .select("id_user")
    .in("id_user", userIds)
    .in("id_type", roleIds);

  if (roleErr) throw new Error(roleErr.message);

  return [...new Set((roleRows || []).map((r) => r.id_user).filter(Boolean))];
}

async function insertMissingGradeRows(rows) {
  if (!rows.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const { error } = await supabaseAdmin
      .from("grades")
      .upsert(chunk, { onConflict: "id_student,id_exam", ignoreDuplicates: true });

    if (error) throw new Error(error.message);
    inserted += chunk.length;
  }

  return inserted;
}

export async function ensureGradeRowsForEvaluation(id_evaluation) {
  const evaluationId = Number(id_evaluation || 0);
  if (!evaluationId) return { attempted: 0 };

  const { data: ev, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_course")
    .eq("id", evaluationId)
    .maybeSingle();

  if (evErr) throw new Error(evErr.message);
  if (!ev?.id || !ev.id_course) return { attempted: 0 };

  const studentIds = await getCourseStudentIds(ev.id_course);
  const rows = studentIds.map((id_student) => ({
    id_student,
    id_exam: ev.id,
    grade: 0,
    attempts: 0,
  }));

  const attempted = await insertMissingGradeRows(rows);
  return { attempted };
}

export async function ensureGradeRowsForStudent(id_student, id_course) {
  const studentId = String(id_student || "").trim();
  const courseId = Number(id_course || 0);
  if (!studentId || !courseId) return { attempted: 0 };

  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id")
    .eq("id_course", courseId);

  if (evalErr) throw new Error(evalErr.message);

  const rows = (evals || []).map((ev) => ({
    id_student: studentId,
    id_exam: ev.id,
    grade: 0,
    attempts: 0,
  }));

  const attempted = await insertMissingGradeRows(rows);
  return { attempted };
}
