import { query } from "../db.js";

const STUDENT_ROLE_CODES = ["S", "M"];
const INSERT_CHUNK_SIZE = 500;

async function getExamenTypeIds() {
  const { rows } = await query(
    `SELECT id FROM evaluation_type WHERE type = $1`,
    ["Examen"]
  );
  return rows.map((r) => r.id).filter(Boolean);
}

async function getStudentRoleIds() {
  const { rows } = await query(
    `SELECT id, code FROM type WHERE code = ANY($1::text[])`,
    [STUDENT_ROLE_CODES]
  );
  return rows.map((r) => r.id).filter(Boolean);
}

async function getStudentIdsByCourseIds(courseIds) {
  const ids = [...new Set((courseIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];

  const { rows: users } = await query(
    `SELECT id FROM users WHERE id_course = ANY($1::bigint[]) AND estado = 'Activo'`,
    [ids]
  );

  const userIds = users.map((u) => u.id).filter(Boolean);
  if (!userIds.length) return [];

  const roleIds = await getStudentRoleIds();
  if (!roleIds.length) return [];

  const { rows: roleRows } = await query(
    `SELECT id_user FROM user_type WHERE id_user = ANY($1::uuid[]) AND id_type = ANY($2::smallint[])`,
    [userIds, roleIds]
  );

  return [...new Set(roleRows.map((r) => r.id_user).filter(Boolean))];
}

function gradeExam(preguntas, respuestas) {
  const respMap = new Map(
    (Array.isArray(respuestas) ? respuestas : []).map((r) => [Number(r.id_pregunta), r.respuesta])
  );

  let calificacion = 0;

  for (const preg of preguntas || []) {
    const studentAns = respMap.get(Number(preg.id));
    const correct = preg.respuesta_correcta;
    let isCorrect = false;

    if (preg.tipo === "multiple_multi") {
      const sa = Array.isArray(studentAns) ? [...studentAns].sort() : [];
      const ca = Array.isArray(correct) ? [...correct].sort() : [];
      isCorrect = JSON.stringify(sa) === JSON.stringify(ca);
    } else if (preg.tipo === "multiple_single" || preg.tipo === "falso_verdadero") {
      const sa = Array.isArray(studentAns) ? studentAns[0] : studentAns;
      const ca = Array.isArray(correct) ? correct[0] : correct;
      isCorrect = String(sa ?? "") === String(ca ?? "");
    } else if (preg.tipo === "emparejamiento") {
      const keys = Object.keys(correct || {});
      if (keys.length > 0 && studentAns && typeof studentAns === "object" && !Array.isArray(studentAns)) {
        const aciertos = keys.filter((k) => String(studentAns[k] ?? "") === String(correct[k] ?? "")).length;
        calificacion += Number(((Number(preg.puntos) * aciertos) / keys.length).toFixed(2));
      }
      continue;
    }

    if (isCorrect) calificacion += Number(preg.puntos || 0);
  }

  return Math.max(0, Math.min(100, Number(calificacion.toFixed(2))));
}

async function insertMissingGrades(rows) {
  if (!rows.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);

    const values = [];
    const placeholders = chunk.map((row, idx) => {
      const base = idx * 5;
      values.push(row.id_student, row.id_exam, row.grade, row.attempts, row.finished_at);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });

    await query(
      `INSERT INTO grades (id_student, id_exam, grade, attempts, finished_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (id_student, id_exam) DO NOTHING`,
      values
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function closeStartedExam(rta, preguntasByEvaluation, finalizadoAt) {
  const preguntas = preguntasByEvaluation.get(Number(rta.id_evaluation)) || [];
  const calificacion = gradeExam(preguntas, rta.respuestas || []);

  await query(
    `UPDATE rta_examen SET calificacion = $1, finalizado_at = $2 WHERE id = $3 AND finalizado_at IS NULL`,
    [calificacion, finalizadoAt, rta.id]
  );

  const gradePayload = {
    grade: calificacion,
    finished_at: finalizadoAt,
    attempts: 1,
  };

  const { rows: updated } = await query(
    `UPDATE grades SET grade = $1, finished_at = $2, attempts = $3
     WHERE id_student = $4 AND id_exam = $5 AND finished_at IS NULL
     RETURNING id_student, id_exam`,
    [gradePayload.grade, gradePayload.finished_at, gradePayload.attempts, rta.id_student, rta.id_evaluation]
  );

  if (updated.length > 0) return { closedStarted: 1 };

  await query(
    `INSERT INTO grades (id_student, id_exam, grade, attempts, finished_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id_student, id_exam) DO NOTHING`,
    [rta.id_student, rta.id_evaluation, gradePayload.grade, gradePayload.attempts, gradePayload.finished_at]
  );

  return { closedStarted: 1 };
}

export async function closeExpiredExams({ studentId = null, courseIds = [], evaluationIds = [] } = {}) {
  const scopedCourseIds = [...new Set((courseIds || []).map(Number).filter(Boolean))];
  const scopedEvaluationIds = [...new Set((evaluationIds || []).map(Number).filter(Boolean))];
  const nowIso = new Date().toISOString();

  const examenTypeIds = await getExamenTypeIds();
  if (!examenTypeIds.length) return { closedStarted: 0, markedMissing: 0 };

  const schedConditions = [`fecha_fin IS NOT NULL`, `fecha_fin < $1`];
  const schedParams = [nowIso];
  if (scopedCourseIds.length) {
    schedParams.push(scopedCourseIds);
    schedConditions.push(`id_course = ANY($${schedParams.length}::bigint[])`);
  }
  if (scopedEvaluationIds.length) {
    schedParams.push(scopedEvaluationIds);
    schedConditions.push(`id_evaluation = ANY($${schedParams.length}::bigint[])`);
  }

  const { rows: schedules } = await query(
    `SELECT id, id_evaluation, id_course, fecha_fin FROM examen_programacion WHERE ${schedConditions.join(" AND ")}`,
    schedParams
  );
  if (!schedules.length) return { closedStarted: 0, markedMissing: 0 };

  const scheduledEvalIds = [...new Set(schedules.map((s) => Number(s.id_evaluation)).filter(Boolean))];
  const { rows: evalRows } = await query(
    `SELECT id, id_course, id_type FROM evaluation WHERE id = ANY($1::bigint[]) AND id_type = ANY($2::bigint[])`,
    [scheduledEvalIds, examenTypeIds]
  );

  const evaluationMap = new Map(evalRows.map((ev) => [Number(ev.id), ev]));
  const effectiveSchedules = schedules.filter((s) => evaluationMap.has(Number(s.id_evaluation)));
  if (!effectiveSchedules.length) return { closedStarted: 0, markedMissing: 0 };

  const effectiveEvalIds = [...new Set(effectiveSchedules.map((s) => Number(s.id_evaluation)))];
  const effectiveCourseIds = [...new Set(effectiveSchedules.map((s) => Number(s.id_course)).filter(Boolean))];
  const studentIds = studentId ? [String(studentId)] : await getStudentIdsByCourseIds(effectiveCourseIds);
  if (!studentIds.length) return { closedStarted: 0, markedMissing: 0 };

  let studentCourseMap = new Map();
  if (!studentId) {
    const { rows: scopedStudents } = await query(
      `SELECT id, id_course FROM users WHERE id = ANY($1::uuid[])`,
      [studentIds]
    );
    studentCourseMap = new Map(scopedStudents.map((u) => [u.id, Number(u.id_course)]));
  }

  const [{ rows: gradeRows }, { rows: rtaRows }, { rows: preguntaRows }] = await Promise.all([
    query(
      `SELECT id_student, id_exam, grade, finished_at, attempts FROM grades
       WHERE id_exam = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
      [effectiveEvalIds, studentIds]
    ),
    query(
      `SELECT id, id_student, id_evaluation, respuestas, calificacion, iniciado_at, finalizado_at FROM rta_examen
       WHERE id_evaluation = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
      [effectiveEvalIds, studentIds]
    ),
    query(
      `SELECT id, id_evaluation, tipo, puntos, respuesta_correcta FROM examen_detalle
       WHERE id_evaluation = ANY($1::bigint[])`,
      [effectiveEvalIds]
    ),
  ]);

  const gradeMap = new Map();
  for (const g of gradeRows) gradeMap.set(`${g.id_student}__${g.id_exam}`, g);

  const rtaMap = new Map();
  for (const r of rtaRows) rtaMap.set(`${r.id_student}__${r.id_evaluation}`, r);

  const preguntasByEvaluation = new Map();
  for (const p of preguntaRows) {
    const key = Number(p.id_evaluation);
    if (!preguntasByEvaluation.has(key)) preguntasByEvaluation.set(key, []);
    preguntasByEvaluation.get(key).push(p);
  }

  let closedStarted = 0;
  const noPresentoRows = [];

  for (const evalId of effectiveEvalIds) {
    for (const sid of studentIds) {
      if (!studentId) {
        const stCourseId = studentCourseMap.get(sid);
        const matchesCourse = effectiveSchedules.some(
          (s) => Number(s.id_evaluation) === Number(evalId) && Number(s.id_course) === Number(stCourseId)
        );
        if (!matchesCourse) continue;
      }

      const key = `${sid}__${evalId}`;
      const existingGrade = gradeMap.get(key);
      if (existingGrade?.finished_at) continue;

      const rta = rtaMap.get(key);
      if (rta?.id) {
        if (rta.finalizado_at) {
          if (!existingGrade?.finished_at) {
            const calificacion = Number(rta.calificacion ?? 0);
            await query(
              `UPDATE grades SET grade = $1, attempts = 1, finished_at = $2
               WHERE id_student = $3 AND id_exam = $4 AND finished_at IS NULL`,
              [calificacion, rta.finalizado_at, sid, evalId]
            );
          }
          continue;
        }

        const result = await closeStartedExam(rta, preguntasByEvaluation, nowIso);
        closedStarted += result.closedStarted;
        continue;
      }

      if (existingGrade && !existingGrade.finished_at) {
        const attempts = existingGrade.attempts === null ? 0 : existingGrade.attempts;
        await query(
          `UPDATE grades SET finished_at = $1, attempts = $2
           WHERE id_student = $3 AND id_exam = $4 AND finished_at IS NULL`,
          [nowIso, attempts, sid, evalId]
        );
        continue;
      }

      noPresentoRows.push({
        id_student: sid,
        id_exam: evalId,
        grade: 0,
        attempts: 0,
        finished_at: nowIso,
      });
    }
  }

  const markedMissing = await insertMissingGrades(noPresentoRows);
  return { closedStarted, markedMissing };
}
