import 'dotenv/config';
import { chromium } from 'playwright';
import { supabaseAdmin } from '../supabase.js';

const {
  ETM_BASE_URL,
  ETM_LOGIN_URL,
  ETM_USERNAME,
  SUPABASE_URL,
  ETM_PASSWORD,
  ETM_GET_RESULTS_PATH,
  ETM_PAGE_SIZE = '100',
  JOB_TZ = 'America/Bogota',
  // opcional: forzar un curso específico
  ETM_COURSE_ID,
} = process.env;

if (!ETM_BASE_URL || !ETM_LOGIN_URL || !ETM_USERNAME || !ETM_PASSWORD || !ETM_GET_RESULTS_PATH) {
  throw new Error('Faltan variables de entorno ETM_* en .env');
}

function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/** Ventana semana anterior: [lunes 00:00, lunes 00:00) en TZ. */
function previousWeekWindow(tz) {
  const now = new Date();

  const dowStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = map[dowStr];

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
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
  const url = new URL(ETM_GET_RESULTS_PATH, ETM_BASE_URL);
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

function parsePercent(pctText) {
  const s = String(pctText ?? '').trim();
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * testName: "<ID_MATERIA> - <NOMBRE_TEST>"
 * retorna { classId, testTitle, raw }
 */
function parseClassIdAndTitleFromTestName(testName) {
  const raw = String(testName ?? '').trim();
  if (!raw) return { classId: null, testTitle: null, raw };

  // captura: numero + guion + resto
  const m = raw.match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return { classId: null, testTitle: raw, raw };

  const classId = Number(m[1]);
  const testTitle = String(m[2] ?? '').trim();

  return {
    classId: Number.isFinite(classId) ? classId : null,
    testTitle: testTitle || null,
    raw,
  };
}

/** Anti-trampa: agrupa por (cedula + testName) y conserva el peor intento */
function applyAntiCheatWorstAttemptOnly(rows) {
  const kept = new Map(); // key -> { row, attempts }

  for (const r of rows) {
    const cedula = parseCedula(r.studentDescription) ?? String(r.studentDescription ?? '').trim();
    const testKey = String(r.testName ?? '').trim(); // incluye "ID - Nombre"
    const key = `${cedula}||${testKey}`;

    const pct = parsePercent(r.pointsPercentageDisplay);
    const pts = typeof r.pointsAwarded === 'number' ? r.pointsAwarded : Number(r.pointsAwarded ?? 0);
    const ft = r.finishTime ? new Date(r.finishTime).getTime() : 0;

    if (!kept.has(key)) {
      kept.set(key, { row: r, attempts: 1 });
      continue;
    }

    const curObj = kept.get(key);
    curObj.attempts += 1;

    const cur = curObj.row;
    const curPct = parsePercent(cur.pointsPercentageDisplay);
    const curPts = typeof cur.pointsAwarded === 'number' ? cur.pointsAwarded : Number(cur.pointsAwarded ?? 0);
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

function chunkArray(arr, size = 20) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getTeacherForClass(classId) {
  // Si hay más de uno, toma el primero
  const { data, error } = await supabaseAdmin
    .from('class_teacher')
    .select('id_teacher')
    .eq('id_class', classId)
    .limit(1);

  if (error) throw new Error(`Error leyendo class_teacher classId=${classId}: ${error.message}`);
  const tid = data?.[0]?.id_teacher;
  if (!tid) throw new Error(`No hay teacher asignado en class_teacher para id_class=${classId}`);
  return tid;
}

async function getStudentsByCourse(courseId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id,cedula')
    .eq('id_course', courseId);

  if (error) throw new Error(`Error leyendo students courseId=${courseId}: ${error.message}`);
  return data ?? [];
}

/**
 * Asegura evaluation usando SOLO:
 * - courseId, classId, typeId(Parcial), title = testTitle
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
      percent: 0,
      title: cleanTitle,
    })
    .select('id')
    .single();

  if (error) throw new Error(`ensureEvaluation insert: ${error.message}`);
  return data.id;
}

/** Trae ids de estudiantes que ya tienen grade para esa evaluación */
async function getExistingGradeStudentIdsForEval(evalId) {
  const existing = new Set();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('grades')
      .select('id_student')
      .eq('id_exam', evalId)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Error leyendo grades existentes evalId=${evalId}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) existing.add(r.id_student);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return existing;
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
      // Solo terminados y calificados
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

  // anti-cheat (peor intento por cedula+testName)
  const collapsed = applyAntiCheatWorstAttemptOnly(weekly);
  console.log(`Collapsed rows (unique cedula+test, keep WORST): ${collapsed.length}`);

  // evaluation_type = Parcial
  const { data: parcialType, error: parcialErr } = await supabaseAdmin
    .from('evaluation_type')
    .select('id')
    .eq('type', 'Parcial')
    .maybeSingle();

  if (parcialErr) throw new Error(`Error leyendo evaluation_type Parcial: ${parcialErr.message}`);
  if (!parcialType?.id) throw new Error("Falta evaluation_type 'Parcial' (créalo como admin).");

  const forcedCourseId = ETM_COURSE_ID ? Number(ETM_COURSE_ID) : null;

  // Cache de estudiantes por curso
  const studentsByCourse = new Map(); // courseId -> { list, byCedula }
  async function ensureStudentsCache(courseId) {
    if (studentsByCourse.has(courseId)) return studentsByCourse.get(courseId);
    const list = await getStudentsByCourse(courseId);
    const byCedula = new Map();
    for (const s of list) {
      if (s.cedula) byCedula.set(String(s.cedula), s.id);
    }
    const obj = { list, byCedula };
    studentsByCourse.set(courseId, obj);
    return obj;
  }

  /**
   * presentados:
   * keyEval = `${courseId}||${classId}||${testTitle}`
   * value: Map(studentId -> {grade, finished_at, attempts})
   */
  const presented = new Map();
  const evalMeta = new Map(); // keyEval -> { courseId, classId, testTitle }

  let matchedStudents = 0;
  let skippedNoStudent = 0;
  let skippedBadTestName = 0;

  // Armamos los “presentados” (NOTA: aún no creamos evaluation aquí)
  for (const { row, attempts } of collapsed) {
    const cedula = parseCedula(row.studentDescription);
    if (!cedula) continue;

    const { data: student, error: studentErr } = await supabaseAdmin
      .from('users')
      .select('id,id_course,cedula')
      .eq('cedula', cedula)
      .maybeSingle();

    if (studentErr) {
      console.error(`Student lookup error cedula=${cedula}:`, studentErr.message);
      continue;
    }
    if (!student?.id || !student.id_course) {
      skippedNoStudent += 1;
      continue;
    }

    // curso real del estudiante (o forzado)
    const courseId = forcedCourseId ?? student.id_course;
    if (forcedCourseId && student.id_course !== forcedCourseId) {
      skippedNoStudent += 1;
      continue;
    }

    const parsed = parseClassIdAndTitleFromTestName(row.testName);
    const classId = parsed.classId;
    const testTitle = parsed.testTitle;

    if (!classId || !testTitle) {
      skippedBadTestName += 1;
      console.error(`No pude parsear testName="${row.testName}" (cedula=${cedula})`);
      continue;
    }

    matchedStudents += 1;

    const keyEval = `${courseId}||${classId}||${testTitle}`;
    if (!presented.has(keyEval)) presented.set(keyEval, new Map());

    const pct = parsePercent(row.pointsPercentageDisplay); // number o null
    const finishedAt = row.finishTime ? new Date(row.finishTime).toISOString() : null;

    presented.get(keyEval).set(student.id, {
      grade: pct ?? null,
      finished_at: finishedAt,
      attempts,
    });

    if (!evalMeta.has(keyEval)) {
      evalMeta.set(keyEval, { courseId, classId, testTitle });
    }
  }

  console.log(`\nPre-resumen:`);
  console.log(`- Evaluaciones únicas detectadas: ${evalMeta.size}`);
  console.log(`- Matches estudiante por cédula: ${matchedStudents}`);
  console.log(`- Saltadas por no encontrar estudiante/curso: ${skippedNoStudent}`);
  console.log(`- Saltadas por testName inválido: ${skippedBadTestName}`);

  let ensuredEvals = 0;
  let insertedEmpty = 0;
  let insertedPresented = 0;
  let skippedEmptyExisting = 0;
  let skippedPresentedExisting = 0;

  // Por cada evaluación (course + class + title)
  for (const [keyEval, meta] of evalMeta.entries()) {
    const { courseId, classId, testTitle } = meta;

    // teacher desde class_teacher
    const teacherId = await getTeacherForClass(classId);

    // asegura evaluation (buscando por title = testTitle)
    const evalId = await ensureEvaluationByTitle({
      courseId,
      classId,
      typeId: parcialType.id,
      teacherId,
      title: testTitle,
    });
    ensuredEvals += 1;

    // estudiantes del curso
    const cache = await ensureStudentsCache(courseId);
    const studentList = cache.list;

    // existentes en grades para este evalId (para NO volver a insertar nada)
    const existingStudentIds = await getExistingGradeStudentIdsForEval(evalId);

    // 1) Insertar vacíos SOLO para quienes NO tengan fila aún
    const emptyCandidates = studentList
      .filter(s => !existingStudentIds.has(s.id))
      .map(s => ({
        id_student: s.id,
        id_exam: evalId,
        grade: null,
        finished_at: null,
        attempts: null,
        source: 'ETM',
      }));

    skippedEmptyExisting += (studentList.length - emptyCandidates.length);

    for (const ch of chunkArray(emptyCandidates, 20)) {
      if (ch.length === 0) continue;
      const ins = await supabaseAdmin.from('grades').insert(ch);
      if (ins.error) {
        console.error(`Insert empty chunk error evalId=${evalId}:`, ins.error.message);
      } else {
        insertedEmpty += ch.length;
        for (const r of ch) existingStudentIds.add(r.id_student);
      }
    }

    // 2) Insertar presentados SOLO si NO existe ya fila
    const presMap = presented.get(keyEval) ?? new Map();
    const presentedCandidates = Array.from(presMap.entries())
      .filter(([studentId]) => !existingStudentIds.has(studentId))
      .map(([studentId, v]) => ({
        id_student: studentId,
        id_exam: evalId,
        grade: v.grade, // número o null
        finished_at: v.finished_at,
        attempts: v.attempts,
        source: 'ETM',
      }));

    skippedPresentedExisting += (presMap.size - presentedCandidates.length);

    for (const ch of chunkArray(presentedCandidates, 20)) {
      if (ch.length === 0) continue;
      const ins = await supabaseAdmin.from('grades').insert(ch);
      if (ins.error) {
        console.error(`Insert presented chunk error evalId=${evalId}:`, ins.error.message);
      } else {
        insertedPresented += ch.length;
        for (const r of ch) existingStudentIds.add(r.id_student);
      }
    }

    console.log(
      `Eval OK: course=${courseId}, class=${classId}, title="${testTitle}" | ` +
      `empty_inserted=${emptyCandidates.length}, presented_inserted=${presentedCandidates.length}, ` +
      `skipped_existing(empty=${studentList.length - emptyCandidates.length}, presented=${presMap.size - presentedCandidates.length})`
    );
  }

  console.log(`\nResumen final:`);
  console.log(`- Evaluaciones aseguradas (Parcial): ${ensuredEvals}`);
  console.log(`- Grades vacíos insertados: ${insertedEmpty}`);
  console.log(`- Grades de presentados insertados: ${insertedPresented}`);
  console.log(`- Grades vacíos saltados por ya existir: ${skippedEmptyExisting}`);
  console.log(`- Presentados saltados por ya existir: ${skippedPresentedExisting}`);
  console.log(`\nETM sync finished.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWeeklySync().catch(err => {
    console.error('ERROR:', err?.message || err);
    process.exit(1);
  });
}