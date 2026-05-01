import { supabaseAdmin } from "../supabase.js";

const STUDENT_ROLE_CODES = ["S", "M"];
const INSERT_CHUNK_SIZE = 500;

async function getExamenTypeIds() {
  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .select("id")
    .eq("type", "Examen");

  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.id).filter(Boolean);
}

async function getStudentRoleIds() {
  const { data, error } = await supabaseAdmin
    .from("type")
    .select("id,code")
    .in("code", STUDENT_ROLE_CODES);

  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.id).filter(Boolean);
}

async function getStudentIdsByCourseIds(courseIds) {
  const ids = [...new Set((courseIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];

  const { data: users, error: usersErr } = await supabaseAdmin
    .from("users")
    .select("id")
    .in("id_course", ids);

  if (usersErr) throw new Error(usersErr.message);

  const userIds = (users || []).map((u) => u.id).filter(Boolean);
  if (!userIds.length) return [];

  const roleIds = await getStudentRoleIds();
  if (!roleIds.length) return [];

  const { data: roleRows, error: roleErr } = await supabaseAdmin
    .from("user_type")
    .select("id_user")
    .in("id_user", userIds)
    .in("id_type", roleIds);

  if (roleErr) throw new Error(roleErr.message);
  return [...new Set((roleRows || []).map((r) => r.id_user).filter(Boolean))];
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
    const { error } = await supabaseAdmin
      .from("grades")
      .upsert(chunk, { onConflict: "id_student,id_exam", ignoreDuplicates: true });

    if (error) throw new Error(error.message);
    inserted += chunk.length;
  }
  return inserted;
}

async function closeStartedExam(rta, preguntasByEvaluation, finalizadoAt) {
  const preguntas = preguntasByEvaluation.get(Number(rta.id_evaluation)) || [];
  const calificacion = gradeExam(preguntas, rta.respuestas || []);

  const { error: rtaErr } = await supabaseAdmin
    .from("rta_examen")
    .update({ calificacion, finalizado_at: finalizadoAt })
    .eq("id", rta.id)
    .is("finalizado_at", null);

  if (rtaErr) throw new Error(rtaErr.message);

  const gradePayload = {
    grade: calificacion,
    finished_at: finalizadoAt,
    attempts: 1,
  };

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("grades")
    .update(gradePayload)
    .eq("id_student", rta.id_student)
    .eq("id_exam", rta.id_evaluation)
    .is("finished_at", null)
    .select("id_student,id_exam");

  if (updErr) throw new Error(updErr.message);
  if ((updated || []).length > 0) return { closedStarted: 1 };

  const { error: insErr } = await supabaseAdmin
    .from("grades")
    .upsert(
      {
        id_student: rta.id_student,
        id_exam: rta.id_evaluation,
        ...gradePayload,
      },
      { onConflict: "id_student,id_exam", ignoreDuplicates: true }
    );

  if (insErr) throw new Error(insErr.message);
  return { closedStarted: 1 };
}

export async function closeExpiredExams({ studentId = null, courseIds = [], evaluationIds = [] } = {}) {
  const scopedCourseIds = [...new Set((courseIds || []).map(Number).filter(Boolean))];
  const scopedEvaluationIds = [...new Set((evaluationIds || []).map(Number).filter(Boolean))];
  const nowIso = new Date().toISOString();

  const examenTypeIds = await getExamenTypeIds();
  if (!examenTypeIds.length) return { closedStarted: 0, markedMissing: 0 };

  let schedQuery = supabaseAdmin
    .from("examen_programacion")
    .select("id,id_evaluation,id_course,fecha_fin")
    .not("fecha_fin", "is", null)
    .lt("fecha_fin", nowIso);

  if (scopedCourseIds.length) schedQuery = schedQuery.in("id_course", scopedCourseIds);
  if (scopedEvaluationIds.length) schedQuery = schedQuery.in("id_evaluation", scopedEvaluationIds);

  const { data: schedules, error: schedErr } = await schedQuery;
  if (schedErr) throw new Error(schedErr.message);
  if (!(schedules || []).length) return { closedStarted: 0, markedMissing: 0 };

  const scheduledEvalIds = [...new Set(schedules.map((s) => Number(s.id_evaluation)).filter(Boolean))];
  const { data: evalRows, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_course,id_type")
    .in("id", scheduledEvalIds)
    .in("id_type", examenTypeIds);

  if (evalErr) throw new Error(evalErr.message);

  const evaluationMap = new Map((evalRows || []).map((ev) => [Number(ev.id), ev]));
  const effectiveSchedules = (schedules || []).filter((s) => evaluationMap.has(Number(s.id_evaluation)));
  if (!effectiveSchedules.length) return { closedStarted: 0, markedMissing: 0 };

  const effectiveEvalIds = [...new Set(effectiveSchedules.map((s) => Number(s.id_evaluation)))];
  const effectiveCourseIds = [...new Set(effectiveSchedules.map((s) => Number(s.id_course)).filter(Boolean))];
  const studentIds = studentId ? [String(studentId)] : await getStudentIdsByCourseIds(effectiveCourseIds);
  if (!studentIds.length) return { closedStarted: 0, markedMissing: 0 };

  let studentCourseMap = new Map();
  if (!studentId) {
    const { data: scopedStudents, error: scopedStudentsErr } = await supabaseAdmin
      .from("users")
      .select("id,id_course")
      .in("id", studentIds);
    if (scopedStudentsErr) throw new Error(scopedStudentsErr.message);
    studentCourseMap = new Map((scopedStudents || []).map((u) => [u.id, Number(u.id_course)]));
  }

  const [{ data: gradeRows, error: gradesErr }, { data: rtaRows, error: rtaErr }, { data: preguntaRows, error: pregErr }] =
    await Promise.all([
      supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,finished_at,attempts")
        .in("id_exam", effectiveEvalIds)
        .in("id_student", studentIds),
      supabaseAdmin
        .from("rta_examen")
        .select("id,id_student,id_evaluation,respuestas,calificacion,iniciado_at,finalizado_at")
        .in("id_evaluation", effectiveEvalIds)
        .in("id_student", studentIds),
      supabaseAdmin
        .from("examen_detalle")
        .select("id,id_evaluation,tipo,puntos,respuesta_correcta")
        .in("id_evaluation", effectiveEvalIds),
    ]);

  if (gradesErr) throw new Error(gradesErr.message);
  if (rtaErr) throw new Error(rtaErr.message);
  if (pregErr) throw new Error(pregErr.message);

  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(`${g.id_student}__${g.id_exam}`, g);

  const rtaMap = new Map();
  for (const r of rtaRows || []) rtaMap.set(`${r.id_student}__${r.id_evaluation}`, r);

  const preguntasByEvaluation = new Map();
  for (const p of preguntaRows || []) {
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
            const { error } = await supabaseAdmin
              .from("grades")
              .update({ grade: calificacion, attempts: 1, finished_at: rta.finalizado_at })
              .eq("id_student", sid)
              .eq("id_exam", evalId)
              .is("finished_at", null);
            if (error) throw new Error(error.message);
          }
          continue;
        }

        const result = await closeStartedExam(rta, preguntasByEvaluation, nowIso);
        closedStarted += result.closedStarted;
        continue;
      }

      if (existingGrade && !existingGrade.finished_at) {
        const patch = { finished_at: nowIso };
        if (existingGrade.attempts === null) patch.attempts = 0;
        const { error } = await supabaseAdmin
          .from("grades")
          .update(patch)
          .eq("id_student", sid)
          .eq("id_exam", evalId)
          .is("finished_at", null);
        if (error) throw new Error(error.message);
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
