import 'dotenv/config';
import { chromium } from 'playwright';
import { supabaseAdmin } from '../supabase.js';

const {
  ETM_BASE_URL,
  ETM_LOGIN_URL,
  ETM_USERNAME,
  ETM_PASSWORD,
  USER_ETM_GET_RESULTS_PATH,
  ETM_PAGE_SIZE = '100',
  JOB_TZ = 'America/Bogota',
  // opcional: forzar un curso específico
  ETM_COURSE_ID,
} = process.env;

if (!ETM_BASE_URL || !ETM_LOGIN_URL || !ETM_USERNAME || !ETM_PASSWORD || !USER_ETM_GET_RESULTS_PATH) {
  throw new Error('Faltan variables de entorno ETM_* en .env');
}

function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/** Ventana semana anterior: [lunes 00:00, lunes 00:00) en TZ. */
function previousWeekWindow(tz) {
  const now = new Date();

  const dowStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(now);

  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = map[dowStr];

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;

  const todayLocalMidnight = new Date(`${y}-${m}-${d}T00:00:00`);
  const daysSinceMonday = (dow + 6) % 7;

  const thisMonday = new Date(todayLocalMidnight);
  thisMonday.setDate(thisMonday.getDate() - daysSinceMonday);

  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);

  return { start: prevMonday, end: thisMonday };
}

async function loginGetCookies() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(ETM_LOGIN_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#tbUsername');
  await page.waitForSelector('#tbPassword');

  await page.fill('#tbUsername', ETM_USERNAME);
  await page.fill('#tbPassword', ETM_PASSWORD);
  await page.click('button[type="submit"]');

  const probeUrl = new URL('/User', ETM_BASE_URL).toString();
  await page.goto(probeUrl, { waitUntil: 'domcontentloaded' });

  if (page.url().toLowerCase().includes('/login')) {
    await browser.close();
    throw new Error(`Login falló: redirigió a ${page.url()}`);
  }

  const cookies = await context.cookies();
  await browser.close();
  return cookies;
}

async function fetchPage(cookieHeader, page, pageSize) {
  const url = new URL(USER_ETM_GET_RESULTS_PATH, ETM_BASE_URL);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Cookie: cookieHeader,
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ct=${ct} body(300)=${body.slice(0, 300)}`);
  }
  if (!ct.includes('application/json')) {
    const text = await res.text();
    throw new Error(`No JSON. ct=${ct} sample=${text.slice(0, 200)}`);
  }

  return await res.json();
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.testResults)) return payload.testResults;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

/** Cédula desde studentDescription */
function parseCedula(studentDescription) {
  const s = String(studentDescription ?? '');
  const m = s.match(/\b\d{6,12}\b/);
  return m ? m[0] : null;
}

function normalizeCedula(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  const noLeadingZeros = digits.replace(/^0+/, '');
  return noLeadingZeros || '0';
}

function parsePercent(pctText) {
  const s = String(pctText ?? '').trim();
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * Esperado:
 *   "201 - El Espiritu Santo y su obra -490 (v3)"
 *
 * Retorna:
 * - prefixCode: 201
 * - subjectName: "El Espiritu Santo y su obra"
 * - classId: 490
 * - version: "v3"
 * - evaluationTitle: "El Espiritu Santo y su obra (v3)"
 */
function parseEtmTestName(testName) {
  const raw = String(testName ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return {
      raw,
      prefixCode: null,
      subjectName: null,
      classId: null,
      version: null,
      evaluationTitle: null,
    };
  }

  const m = raw.match(/^(\d+)\s*-\s*(.*?)\s*-\s*(\d+)(?:\s*\(([^)]+)\))?$/i);

  if (!m) {
    return {
      raw,
      prefixCode: null,
      subjectName: raw,
      classId: null,
      version: null,
      evaluationTitle: raw,
    };
  }

  const prefixCode = Number(m[1]);
  const subjectName = String(m[2] ?? '').trim();
  const classId = Number(m[3]);
  const version = m[4] ? String(m[4]).trim() : null;

  const evaluationTitle = version
    ? `${subjectName} (${version})`
    : subjectName;

  return {
    raw,
    prefixCode: Number.isFinite(prefixCode) ? prefixCode : null,
    subjectName: subjectName || null,
    classId: Number.isFinite(classId) ? classId : null,
    version,
    evaluationTitle: evaluationTitle || raw || null,
  };
}

/** Anti-trampa: agrupa por (cedula + testName) y conserva el peor intento */
function applyAntiCheatWorstAttemptOnly(rows) {
  const kept = new Map(); // key -> { row, attempts }

  for (const r of rows) {
    const cedula = parseCedula(r.studentDescription) ?? String(r.studentDescription ?? '').trim();
    const testKey = String(r.testName ?? '').trim();
    const key = `${cedula}||${testKey}`;

    const pct = parsePercent(r.pointsPercentageDisplay);
    const pts = typeof r.pointsAwarded === 'number'
      ? r.pointsAwarded
      : Number(r.pointsAwarded ?? 0);
    const ft = r.finishTime ? new Date(r.finishTime).getTime() : 0;

    if (!kept.has(key)) {
      kept.set(key, { row: r, attempts: 1 });
      continue;
    }

    const curObj = kept.get(key);
    curObj.attempts += 1;

    const cur = curObj.row;
    const curPct = parsePercent(cur.pointsPercentageDisplay);
    const curPts = typeof cur.pointsAwarded === 'number'
      ? cur.pointsAwarded
      : Number(cur.pointsAwarded ?? 0);
    const curFt = cur.finishTime ? new Date(cur.finishTime).getTime() : 0;

    const rIsWorse =
      (pct !== null && curPct !== null && pct < curPct) ||
      (pct === null && curPct !== null) ||
      (pct === curPct && pts < curPts) ||
      (pct === curPct && pts === curPts && ft > curFt);

    if (rIsWorse) curObj.row = r;
  }

  return Array.from(kept.values()); // { row, attempts }
}

function chunkArray(arr, size = 200) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getTeacherForClass(classId) {
  const { data, error } = await supabaseAdmin
    .from('class_teacher')
    .select('id_teacher')
    .eq('id_class', classId)
    .limit(1);

  if (error) {
    throw new Error(`Error leyendo class_teacher classId=${classId}: ${error.message}`);
  }

  const tid = data?.[0]?.id_teacher;
  if (!tid) {
    throw new Error(`No hay teacher asignado en class_teacher para id_class=${classId}`);
  }

  return tid;
}

async function getStudentsByCourse(courseId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, cedula')
    .eq('id_course', courseId);

  if (error) {
    throw new Error(`Error leyendo students courseId=${courseId}: ${error.message}`);
  }

  return data ?? [];
}

async function getAllUsersBasic() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, id_course, cedula');

  if (error) {
    throw new Error(`Error leyendo users: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Asegura evaluation usando:
 * - courseId
 * - classId
 * - typeId(Parcial)
 * - title = evaluationTitle
 */
async function ensureEvaluationByTitle({ courseId, classId, typeId, teacherId, title }) {
  const cleanTitle = String(title ?? '').trim();

  const { data: found, error: findErr } = await supabaseAdmin
    .from('evaluation')
    .select('id')
    .eq('id_course', courseId)
    .eq('id_class', classId)
    .eq('id_type', typeId)
    .eq('title', cleanTitle)
    .maybeSingle();

  if (findErr) throw new Error(`ensureEvaluation find: ${findErr.message}`);
  if (found?.id) return found.id;

  const { data, error } = await supabaseAdmin
    .from('evaluation')
    .insert({
      id_course: courseId,
      id_class: classId,
      id_type: typeId,
      id_teacher: teacherId,
      percent: 100,
      title: cleanTitle,
    })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`ensureEvaluation insert: ${error.message}`);
  return data.id;
}

export async function runWeeklySync() {
  const { start, end } = previousWeekWindow(JOB_TZ);
  console.log(`ETM weekly window (${JOB_TZ}): ${start.toISOString()} -> ${end.toISOString()}`);

  const cookies = await loginGetCookies();
  const cookieHeader = cookiesToHeader(cookies);

  const pageSize = parseInt(ETM_PAGE_SIZE, 10);
  let page = 1;

  const weekly = [];
  let totalFetched = 0;

  while (true) {
    const payload = await fetchPage(cookieHeader, page, pageSize);
    const rows = extractRows(payload);
    if (rows.length === 0) break;

    totalFetched += rows.length;

    for (const r of rows) {
      if (!r.isFinished || !r.isGradingComplete) continue;
      if (r.gradingStatus !== 'Graded') continue;
      if (!r.finishTime) continue;

      const ft = new Date(r.finishTime);
      if (ft >= start && ft < end) weekly.push(r);
    }

    const last = rows[rows.length - 1];
    if (last?.finishTime) {
      const lastFt = new Date(last.finishTime);
      if (lastFt < start) break;
    }

    if (rows.length < pageSize) break;
    page += 1;
  }

  console.log(`Total registros leídos: ${totalFetched}`);
  console.log(`Weekly graded rows: ${weekly.length}`);

  const collapsed = applyAntiCheatWorstAttemptOnly(weekly);
  console.log(`Collapsed rows (unique cedula+test, keep WORST): ${collapsed.length}`);

  const { data: parcialType, error: parcialErr } = await supabaseAdmin
    .from('evaluation_type')
    .select('id')
    .eq('type', 'Parcial')
    .maybeSingle();

  if (parcialErr) throw new Error(`Error leyendo evaluation_type Parcial: ${parcialErr.message}`);
  if (!parcialType?.id) throw new Error("Falta evaluation_type 'Parcial' (créalo como admin).");

  const forcedCourseId = ETM_COURSE_ID ? Number(ETM_COURSE_ID) : null;

  // Cache global de usuarios por cédula
  const allUsers = await getAllUsersBasic();
  const usersByCedula = new Map();

  for (const u of allUsers) {
    const rawCedula = u.cedula ? String(u.cedula).trim() : null;
    const normCedula = normalizeCedula(u.cedula);

    if (rawCedula && !usersByCedula.has(rawCedula)) {
      usersByCedula.set(rawCedula, u);
    }
    if (normCedula && !usersByCedula.has(normCedula)) {
      usersByCedula.set(normCedula, u);
    }
  }

  // Cache de estudiantes por curso
  const studentsByCourse = new Map();
  async function ensureStudentsCache(courseId) {
    if (studentsByCourse.has(courseId)) return studentsByCourse.get(courseId);
    const list = await getStudentsByCourse(courseId);
    const obj = { list };
    studentsByCourse.set(courseId, obj);
    return obj;
  }

  /**
   * presented:
   * keyEval = `${courseId}||${classId}||${evaluationTitle}`
   * value: Map(studentId -> {grade, finished_at, attempts})
   */
  const presented = new Map();
  const evalMeta = new Map();

  let matchedStudents = 0;
  let skippedNoStudent = 0;
  let skippedBadTestName = 0;
  let skippedByForcedCourse = 0;

  for (const { row, attempts } of collapsed) {
    const extractedCedulaRaw = parseCedula(row.studentDescription);
    const extractedCedulaNorm = normalizeCedula(extractedCedulaRaw);

    if (!extractedCedulaRaw && !extractedCedulaNorm) {
      skippedNoStudent += 1;
      continue;
    }

    const parsed = parseEtmTestName(row.testName);
    const classId = parsed.classId;
    const evaluationTitle = parsed.evaluationTitle;

    if (!classId || !evaluationTitle) {
      skippedBadTestName += 1;
      console.error(`No pude parsear testName="${row.testName}"`);
      continue;
    }

    const student =
      usersByCedula.get(extractedCedulaRaw) ||
      usersByCedula.get(extractedCedulaNorm);

    if (!student?.id || !student.id_course) {
      skippedNoStudent += 1;
      continue;
    }

    const courseId = forcedCourseId ?? student.id_course;

    if (forcedCourseId && student.id_course !== forcedCourseId) {
      skippedByForcedCourse += 1;
      continue;
    }

    matchedStudents += 1;

    const keyEval = `${courseId}||${classId}||${evaluationTitle}`;
    if (!presented.has(keyEval)) presented.set(keyEval, new Map());

    const pct = parsePercent(row.pointsPercentageDisplay);
    const finishedAt = row.finishTime ? new Date(row.finishTime).toISOString() : null;

    presented.get(keyEval).set(student.id, {
      grade: pct ?? 0,
      finished_at: finishedAt,
      attempts,
    });

    if (!evalMeta.has(keyEval)) {
      evalMeta.set(keyEval, {
        courseId,
        classId,
        evaluationTitle,
        rawTestName: parsed.raw,
        subjectName: parsed.subjectName,
        prefixCode: parsed.prefixCode,
        version: parsed.version,
      });
    }
  }

  console.log(`\nPre-resumen:`);
  console.log(`- Evaluaciones únicas detectadas: ${evalMeta.size}`);
  console.log(`- Matches estudiante por cédula: ${matchedStudents}`);
  console.log(`- Saltadas por no encontrar estudiante/curso: ${skippedNoStudent}`);
  console.log(`- Saltadas por testName inválido: ${skippedBadTestName}`);
  console.log(`- Saltadas por ETM_COURSE_ID forzado: ${skippedByForcedCourse}`);

  let ensuredEvals = 0;
  let upsertedGrades = 0;
  let totalDefaultsZero = 0;
  let totalPresentedReal = 0;
  let skippedNoClassTeacher = 0;

  for (const [keyEval, meta] of evalMeta.entries()) {
    const { courseId, classId, evaluationTitle } = meta;

    let teacherId;
    try {
      teacherId = await getTeacherForClass(classId);
    } catch (err) {
      skippedNoClassTeacher += 1;
      console.error(`Saltando evaluación classId=${classId}: ${err.message}`);
      continue;
    }

    const evalId = await ensureEvaluationByTitle({
      courseId,
      classId,
      typeId: parcialType.id,
      teacherId,
      title: evaluationTitle,
    });
    ensuredEvals += 1;

    const cache = await ensureStudentsCache(courseId);
    const studentList = cache.list;
    const presMap = presented.get(keyEval) ?? new Map();

    // Todos arrancan en 0
    const finalGradesMap = new Map();

    for (const s of studentList) {
      finalGradesMap.set(s.id, {
        id_student: s.id,
        id_exam: evalId,
        grade: 0,
        finished_at: null,
        attempts: 0,
      });
    }

    // Los que sí presentaron y matchearon por cédula sobreescriben el 0
    for (const [studentId, v] of presMap.entries()) {
      finalGradesMap.set(studentId, {
        id_student: studentId,
        id_exam: evalId,
        grade: v.grade ?? 0,
        finished_at: v.finished_at,
        attempts: v.attempts,
      });
    }

    const rowsToUpsert = Array.from(finalGradesMap.values());

    totalDefaultsZero += studentList.length;
    totalPresentedReal += presMap.size;

    for (const ch of chunkArray(rowsToUpsert, 200)) {
      if (ch.length === 0) continue;

      const { error } = await supabaseAdmin
        .from('grades')
        .upsert(ch, {
          onConflict: 'id_student,id_exam',
        });

      if (error) {
        console.error(`Upsert grades error evalId=${evalId}: ${error.message}`);
      } else {
        upsertedGrades += ch.length;
      }
    }

    console.log(
      `Eval OK: course=${courseId}, class=${classId}, title="${evaluationTitle}" | ` +
      `students_course=${studentList.length}, presented_matched=${presMap.size}, rows_upserted=${rowsToUpsert.length}`
    );
  }

  console.log(`\nResumen final:`);
  console.log(`- Evaluaciones aseguradas (Parcial): ${ensuredEvals}`);
  console.log(`- Filas grades upsertadas: ${upsertedGrades}`);
  console.log(`- Estudiantes puestos en 0 por defecto: ${totalDefaultsZero}`);
  console.log(`- Estudiantes con nota real ETM: ${totalPresentedReal}`);
  console.log(`- Evaluaciones saltadas por no tener teacher en class_teacher: ${skippedNoClassTeacher}`);
  console.log(`\nETM sync finished.`);
}

// Ejecutar siempre cuando el archivo se corre con node
runWeeklySync().catch(err => {
  console.error('ERROR:', err?.message || err);
  process.exit(1);
});