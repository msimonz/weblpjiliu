import { query } from "../db.js";

const STUDENT_ROLE_CODES = ["S", "M"];
const INSERT_CHUNK_SIZE = 500;

async function getStudentRoleIds() {
  const { rows } = await query(
    `SELECT id, code FROM type WHERE code = ANY($1::text[])`,
    [STUDENT_ROLE_CODES]
  );
  return rows.map((r) => r.id).filter(Boolean);
}

async function getCourseStudentIds(id_course) {
  const courseId = Number(id_course || 0);
  if (!courseId) return [];

  const { rows: users } = await query(
    `SELECT id FROM users WHERE id_course = $1`,
    [courseId]
  );

  const userIds = users.map((u) => u.id).filter(Boolean);
  if (userIds.length === 0) return [];

  const roleIds = await getStudentRoleIds();
  if (roleIds.length === 0) return [];

  const { rows: roleRows } = await query(
    `SELECT id_user FROM user_type WHERE id_user = ANY($1::uuid[]) AND id_type = ANY($2::smallint[])`,
    [userIds, roleIds]
  );

  return [...new Set(roleRows.map((r) => r.id_user).filter(Boolean))];
}

async function insertMissingGradeRows(rows) {
  if (!rows.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);

    const values = [];
    const placeholders = chunk.map((row, idx) => {
      const base = idx * 4;
      values.push(row.id_student, row.id_exam, row.grade, row.attempts);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });

    await query(
      `INSERT INTO grades (id_student, id_exam, grade, attempts)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (id_student, id_exam) DO NOTHING`,
      values
    );
    inserted += chunk.length;
  }

  return inserted;
}

export async function ensureGradeRowsForEvaluation(id_evaluation) {
  const evaluationId = Number(id_evaluation || 0);
  if (!evaluationId) return { attempted: 0 };

  const { rows } = await query(
    `SELECT id, id_course FROM evaluation WHERE id = $1 LIMIT 1`,
    [evaluationId]
  );
  const ev = rows[0];
  if (!ev?.id || !ev.id_course) return { attempted: 0 };

  const studentIds = await getCourseStudentIds(ev.id_course);
  const rowsToInsert = studentIds.map((id_student) => ({
    id_student,
    id_exam: ev.id,
    grade: 0,
    attempts: 0,
  }));

  const attempted = await insertMissingGradeRows(rowsToInsert);
  return { attempted };
}

export async function ensureGradeRowsForStudent(id_student, id_course) {
  const studentId = String(id_student || "").trim();
  const courseId = Number(id_course || 0);
  if (!studentId || !courseId) return { attempted: 0 };

  const { rows: evals } = await query(
    `SELECT id FROM evaluation WHERE id_course = $1`,
    [courseId]
  );

  const rowsToInsert = evals.map((ev) => ({
    id_student: studentId,
    id_exam: ev.id,
    grade: 0,
    attempts: 0,
  }));

  const attempted = await insertMissingGradeRows(rowsToInsert);
  return { attempted };
}
