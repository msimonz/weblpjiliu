import 'dotenv/config';
import { chromium } from 'playwright';
import { supabaseAdmin } from '../supabase.js';

const {
  ETM_BASE_URL,
  ETM_LOGIN_URL,
  ETM_USERNAME,
  ETM_PASSWORD,
  ETM_GET_RESULTS_PATH,
  ETM_PAGE_SIZE = '100',
  JOB_TZ = 'America/Bogota',
  ETM_SYSTEM_EMAIL = 'cuentas.simarq@gmail.com',
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

//PARA LA SEMANA ACTUAL
/*
function previousWeekWindow(tz) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 14);
  return { start, end };
}
*/
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

/**
 * ETM testName:
 * "101 - Nacidos a la familia de Dios"
 * Devuelve:
 *  - level = 1 (por 101 -> 1)
 *  - className = "Nacidos a la familia de Dios"
 */
function parseClassFromTestName(testName) {
  const raw = String(testName ?? '').trim();
  if (!raw) return { level: null, className: null, raw };

  // quita cosas tipo "(v3)" al final
  const withoutVersion = raw.replace(/\s*\(v\d+\)\s*$/i, '').trim();

  // separa "101 - " (o "201 - ") del resto
  const m = withoutVersion.match(/^(\d{3})\s*-\s*(.+)$/);
  if (!m) {
    // si no coincide, igual intentamos usar todo como "materia"
    return { level: null, className: withoutVersion, raw: withoutVersion };
  }

  const code = Number(m[1]); // 101, 201...
  const level = Number.isFinite(code) ? Math.floor(code / 100) : null; // 101->1, 201->2
  const className = String(m[2]).trim();

  return { level, className, raw: withoutVersion };
}

function parsePercent(pctText) {
  const s = String(pctText ?? '').trim();
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]);
}

/** Anti-trampa: agrupa por (cedula + testName) y conserva el peor intento */
function applyAntiCheatWorstAttemptOnly(rows) {
  const kept = new Map(); // key -> { row, attempts }

  for (const r of rows) {
    const cedula = parseCedula(r.studentDescription) ?? String(r.studentDescription ?? '').trim();
    const testKey = String(r.testName ?? '').trim();
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

  return Array.from(kept.values());
}

async function ensureEtmEvaluation({ courseId, classId, typeId, teacherId, title }) {
  const { data: found, error: findErr } = await supabaseAdmin
    .from('evaluation')
    .select('id')
    .eq('id_course', courseId)
    .eq('id_class', classId)
    .eq('id_type', typeId)
    .eq('title', title)
    .maybeSingle();

  if (findErr) throw new Error(`ensureEtmEvaluation find: ${findErr.message}`);
  if (found?.id) return found.id;

  const { data, error } = await supabaseAdmin
    .from('evaluation')
    .insert({
      id_course: courseId,
      id_class: classId,
      id_type: typeId,
      id_teacher: teacherId,
      percent: 0,
      title,
    })
    .select('id')
    .single();

  if (error) throw new Error(`ensureEtmEvaluation insert: ${error.message}`);
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

  // Pre-reqs
  const { data: etmType, error: etmTypeErr } = await supabaseAdmin
    .from('evaluation_type')
    .select('id')
    .eq('type', 'ETM')
    .maybeSingle();

  if (etmTypeErr) throw new Error(`Error leyendo evaluation_type ETM: ${etmTypeErr.message}`);
  if (!etmType?.id) throw new Error("Falta evaluation_type 'ETM' (créalo como admin).");

  const { data: sysTeacher, error: sysTeacherErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', ETM_SYSTEM_EMAIL)
    .maybeSingle();

  if (sysTeacherErr) throw new Error(`Error leyendo ETM System user: ${sysTeacherErr.message}`);
  if (!sysTeacher?.id) throw new Error(`Falta usuario teacher del sistema (email: ${ETM_SYSTEM_EMAIL}).`);

  // Cargar catálogo de materias (class) una sola vez
  const { data: classes, error: classErr } = await supabaseAdmin
    .from('class')
    .select('id,name,level');

  if (classErr) throw new Error(`Error leyendo class: ${classErr.message}`);

  // map por name normalizado (y level opcional)
  const classByName = new Map(); // "name||level" o "name||" -> id
  for (const c of classes ?? []) {
    const nameKey = String(c.name ?? '').trim().toLowerCase();
    const lvlKey = (c.level ?? '') === null ? '' : String(c.level ?? '');
    classByName.set(`${nameKey}||${lvlKey}`, c.id);
    // fallback sin nivel
    classByName.set(`${nameKey}||`, c.id);
  }

  const missingSubjects = new Map(); // key -> count
  let matchedStudents = 0;
  let insertedGrades = 0;
  let skippedNoStudent = 0;

  for (const { row, attempts } of collapsed) {
    const cedula = parseCedula(row.studentDescription);
    if (!cedula) continue;

    // 1) buscar estudiante por cédula
    const { data: student, error: studentErr } = await supabaseAdmin
      .from('users')
      .select('id,id_course')
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
    matchedStudents += 1;

    // 2) sacar materia real desde testName
    const parsed = parseClassFromTestName(row.testName);
    const subjectName = parsed.className;
    const subjectLevel = parsed.level; // puede ser null si no pudo parsear
    if (!subjectName) continue;

    const subjectKey = subjectName.trim().toLowerCase();
    const classId =
      (subjectLevel ? classByName.get(`${subjectKey}||${String(subjectLevel)}`) : null) ??
      classByName.get(`${subjectKey}||`);

    if (!classId) {
      const k = subjectLevel ? `${subjectName} (nivel ${subjectLevel})` : subjectName;
      missingSubjects.set(k, (missingSubjects.get(k) ?? 0) + 1);
      continue; // NO inserta si la materia no existe
    }

    // 3) crear/asegurar evaluation
    const evalId = await ensureEtmEvaluation({
      courseId: student.id_course,
      classId,
      typeId: etmType.id,
      teacherId: sysTeacher.id,
      title: String(row.testName ?? 'ETM Test').trim(), // título completo como aparece en ETM
    });

    const pct = parsePercent(row.pointsPercentageDisplay) ?? 0;

    // 4) upsert grade
    const up = await supabaseAdmin
      .from('grades')
      .upsert(
        {
          id_student: student.id,
          id_exam: evalId,
          grade: pct,
          finished_at: new Date(row.finishTime).toISOString(),
          attempts,
        },
        { onConflict: 'id_student,id_exam' }
      );

    if (up.error) {
      console.error('Upsert grade error:', up.error.message);
    } else {
      insertedGrades += 1;
    }
  }

  console.log(`\nResumen:`);
  console.log(`- Filas colapsadas: ${collapsed.length}`);
  console.log(`- Matches de estudiante por cédula: ${matchedStudents}`);
  console.log(`- Saltadas por no encontrar estudiante: ${skippedNoStudent}`);
  console.log(`- Upserts de grades OK: ${insertedGrades}`);

  if (missingSubjects.size > 0) {
    console.log(`\n⚠️ Materias faltantes en public.class (no se insertó nada de esas):`);
    // imprime top 30
    const list = Array.from(missingSubjects.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
    for (const [name, count] of list) console.log(`- ${name}  (aparece ${count} veces)`);
  } else {
    console.log('\n✅ No faltaron materias: todas existían en public.class');
  }

  console.log('\nETM sync finished.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWeeklySync().catch(err => {
    console.error('ERROR:', err?.message || err);
    process.exit(1);
  });
}
