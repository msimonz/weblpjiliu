import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";
import { chromium } from "playwright";
export const studentRouter = Router();
const PASS_GRADE = 70;

const {
  ETM_CLASSROOM_ID,
  ETM_CLASSROOM_BASE = "https://www.classroomclipboard.com",
  ETM_PUBLIC_PIN,
  ETM_REAL_ACCESS_CODE,
  ETM_CLASSROOM_BASE_PATH_TES, 
  ETM_BASE_URL,
  ETM_LOGIN_URL,
  ETM_USERNAME,
  ETM_PASSWORD,
  ETM_GET_RESULTS_PATH,
} = process.env;

function mustEnv(name) {
  if (!process.env[name]) throw new Error(`Falta variable de entorno ${name} en backend/.env`);
  return process.env[name];
}

function assertEtmLayerEnv() {
  mustEnv("ETM_CLASSROOM_ID");
  mustEnv("ETM_PUBLIC_PIN");
  mustEnv("ETM_REAL_ACCESS_CODE");
  mustEnv("ETM_BASE_URL");
  mustEnv("ETM_LOGIN_URL");
  mustEnv("ETM_USERNAME");
  mustEnv("ETM_PASSWORD");
  mustEnv("ETM_GET_RESULTS_PATH");
}

async function fetchClassroomTests() {
  const baseDns = ETM_CLASSROOM_BASE.replace(/\/$/, "");
  const classroomTes = String(ETM_CLASSROOM_BASE_PATH_TES).trim(); // "api/tests"
  const classroomId = String(ETM_CLASSROOM_ID).trim();             // "826518"

  const url = `${baseDns}/${classroomTes}/${classroomId}`;

  const res = await fetch(url, { method: "GET" });


  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `No pude leer ClassroomClipboard tests: HTTP ${res.status} body(200)=${txt.slice(0, 200)}`
    );
  }

  const data = await res.json(); // ✅ ahora sí
  // data es array

  const out = [];
  for (const t of data) {
    const testId = t.masterTestId;
    const rawText = String(t.name || "").trim();
    if (!testId || !rawText) continue;

    const mm = rawText.match(/^(\d+)\s*-\s*(.+)$/);
    const classId = mm ? Number(mm[1]) : null;
    const testTitle = mm ? String(mm[2]).trim() : rawText;

    if (!classId || !Number.isFinite(classId)) continue;

    out.push({
      testId,
      label: rawText,
      classId,
      testTitle,
      // 🔴 IMPORTANTE: esta URL la debes confirmar (mayúsculas/minúsculas)
      takeUrl: `${baseDns}/${classroomId}/Test/${testId}`,
    });
  }

  // dedupe
  const uniq = new Map();
  for (const t of out) uniq.set(t.testId, t);
  return Array.from(uniq.values());
}

async function filterTestsByStudentCourseLevel(tests, courseLevel) {
  const ids = Array.from(new Set(tests.map((t) => t.classId))).filter(Boolean);
  if (ids.length === 0) return [];

  const { data: classes, error } = await supabaseAdmin
    .from("class")
    .select("id,level,name")
    .in("id", ids);

  if (error) throw new Error(`Error leyendo class para filtrar tests: ${error.message}`);

  const levelByClassId = new Map();
  for (const c of classes || []) levelByClassId.set(Number(c.id), Number(c.level));

  return tests.filter((t) => Number(levelByClassId.get(Number(t.classId))) === Number(courseLevel));
}

function cookiesToHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function loginGetCookiesAdmin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(ETM_LOGIN_URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("#tbUsername");
  await page.waitForSelector("#tbPassword");

  await page.fill("#tbUsername", ETM_USERNAME);
  await page.fill("#tbPassword", ETM_PASSWORD);
  await page.click('button[type="submit"]');

  const probeUrl = new URL("/User", ETM_BASE_URL).toString();
  await page.goto(probeUrl, { waitUntil: "domcontentloaded" });

  if (page.url().toLowerCase().includes("/login")) {
    await browser.close();
    throw new Error(`Login ETM admin falló: redirigió a ${page.url()}`);
  }

  const cookies = await context.cookies();
  await browser.close();
  return cookies;
}

async function fetchEtmResultsPage(cookieHeader, pageNum, pageSize) {
  const url = new URL(ETM_GET_RESULTS_PATH, ETM_BASE_URL);
  url.searchParams.set("page", String(pageNum));
  url.searchParams.set("pageSize", String(pageSize));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ETM results HTTP ${res.status} ct=${ct} body(200)=${body.slice(0, 200)}`);
  }
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(`ETM results no JSON. ct=${ct} sample=${text.slice(0, 200)}`);
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

function parseCedula(studentDescription) {
  const s = String(studentDescription ?? "");
  const m = s.match(/\b\d{6,12}\b/);
  return m ? m[0] : null;
}

// testName en ETM: "101 - Introduccion..."
function parseClassIdAndTitleFromTestName(testName) {
  const raw = String(testName ?? "").trim();
  if (!raw) return { classId: null, testTitle: null };
  const m = raw.match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return { classId: null, testTitle: raw };
  return { classId: Number(m[1]), testTitle: String(m[2] || "").trim() };
}

async function hasInProgressAttempt({ cedula, classId, testTitle }) {
  // Strategy: escanear páginas recientes hasta encontrar coincidencia o agotar.
  const cookies = await loginGetCookiesAdmin();
  const cookieHeader = cookiesToHeader(cookies);

  const pageSize = 100;
  let page = 1;
  let scanned = 0;

  // límite duro para no colgar el backend
  const MAX_SCAN_ROWS = 3000;

  while (true) {
    const payload = await fetchEtmResultsPage(cookieHeader, page, pageSize);
    const rows = extractRows(payload);
    if (!rows || rows.length === 0) break;

    scanned += rows.length;

    for (const r of rows) {
      const c = parseCedula(r.studentDescription);
      if (c !== String(cedula)) continue;

      const p = parseClassIdAndTitleFromTestName(r.testName);
      if (Number(p.classId) !== Number(classId)) continue;

      // Comparamos el "nombre del test" (sin el prefijo numérico)
      const t = String(p.testTitle || "").trim().toLowerCase();
      const wanted = String(testTitle || "").trim().toLowerCase();
      if (t !== wanted) continue;

      // Si NO está graded, lo consideramos “en progreso” (o incompleto)
      const gs = String(r.gradingStatus || "").trim();
      if (gs !== "Graded") return true;
    }

    if (rows.length < pageSize) break;
    if (scanned >= MAX_SCAN_ROWS) break;

    page += 1;
  }

  return false;
}

async function startClassroomTestAndGetLoadUrl({ testId, cedula }) {
  const base = ETM_CLASSROOM_BASE.replace(/\/$/, "");
  const classroomId = String(ETM_CLASSROOM_ID).trim();
  const startUrl = `${base}/${classroomId}/test/${testId}`;
  console.log("BASE", base);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  await page.goto(startUrl, { waitUntil: "domcontentloaded" });

  // Inputs según tu screenshot: placeholders "Full Name" y "Access code or return code"
  await page.getByPlaceholder("Full Name").fill(String(cedula));
  await page.getByPlaceholder("Access code or return code").fill(String(ETM_REAL_ACCESS_CODE));

  // Botón "Start Test"
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: /Start Test/i }).click(),
  ]);

  const urlAfter = page.url();
  console.log("URLAFTER", urlAfter);
  await browser.close();

  
  return urlAfter;
}

async function getStudentCourse(req, res) {
  const courseId = Number(req.auth.profile?.id_course || 0);

  if (!courseId) {
    res.status(400).json({ error: "El usuario no tiene id_course en el profile" });
    return null;
  }

  const { data: course, error } = await supabaseAdmin
    .from("course")
    .select("id,year,level,name")
    .eq("id", courseId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return null;
  }
  if (!course?.id) {
    res.status(404).json({ error: "El course del usuario no existe" });
    return null;
  }

  return course;
}

function checkLevelAllowed(level, course) {
  return Number(level) === Number(course.level);
}

studentRouter.get("/classes", requireAuth, async (req, res) => {
  const level = Number(req.query.level || 1);
  const q = String(req.query.q || "").trim();

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }
  if (!q) return res.json({ items: [] });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  if (!checkLevelAllowed(level, course)) {
    return res.json({
      blocked: true,
      message: "Aún no ha cursado este año.",
      items: [],
      course,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("class")
    .select("id,name,level")
    .eq("level", level)
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ blocked: false, items: data || [], course });
});

studentRouter.get("/subjects-summary", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const level = Number(req.query.level || 1);

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }

  const course = await getStudentCourse(req, res);
  if (!course) return;

  // ✅ si el estudiante no está en ese año, NO se consulta nada
  if (!checkLevelAllowed(level, course)) {
    return res.json({
      blocked: true,
      message: "Aún no ha cursado este año.",
      course,
      items: [],
      stats: null,
    });
  }

  // ✅ evaluaciones del course REAL del estudiante
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_class,percent,title,class:class(id,name)")
    .eq("id_course", course.id);

  if (evalErr) return res.status(500).json({ error: evalErr.message });

  const evaluations = evals || [];
  if (evaluations.length === 0) {
    return res.json({
      blocked: false,
      course,
      items: [],
      stats: { passed: 0, failed: 0, pending: 0, avg_weighted: null, pass_grade: PASS_GRADE },
    });
  }

  const evalIds = evaluations.map((e) => e.id);

  // notas del estudiante SOLO para esas evaluaciones
  const { data: gradeRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("id_exam,grade,id_student")
    .eq("id_student", userId)
    .in("id_exam", evalIds);

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  // map examId -> grade row
  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(g.id_exam, g);

  // agrupar por materia (id_class) y calcular ponderado por materia
  const byClass = new Map(); // classId -> { class_id, name, sumW, sum }
  for (const ev of evaluations) {
    const classId = Number(ev.id_class);
    const className = ev.class?.name ? String(ev.class.name) : `Materia ${classId}`;

    const percent = Number(ev.percent ?? 0);
    const g = gradeMap.get(ev.id) || null;
    const grade = g ? Number(g.grade ?? 0) : null;

    if (!byClass.has(classId)) {
      byClass.set(classId, { class_id: classId, name: className, sumW: 0, sum: 0 });
    }

    if (grade !== null) {
      const obj = byClass.get(classId);
      obj.sumW += percent;
      obj.sum += grade * percent;
    }
  }

  const items = Array.from(byClass.values())
    .map((x) => {
      const weighted = x.sumW > 0 ? Number((x.sum / x.sumW).toFixed(2)) : null;
      return { class_id: x.class_id, name: x.name, weighted };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // stats
  let passed = 0,
    failed = 0,
    pending = 0;
  let avgSum = 0,
    avgCount = 0;

  for (const it of items) {
    if (it.weighted === null) {
      pending += 1;
      continue;
    }
    avgSum += it.weighted;
    avgCount += 1;
    if (it.weighted >= PASS_GRADE) passed += 1;
    else failed += 1;
  }

  const avg_weighted = avgCount > 0 ? Number((avgSum / avgCount).toFixed(2)) : null;

  return res.json({
    blocked: false,
    course,
    items,
    stats: { passed, failed, pending, avg_weighted, pass_grade: PASS_GRADE },
  });
});

/**
 * Notas por materia + ponderado
 * GET /api/student/grades?level=1&class_id=123
 *
 * ✅ Ahora: usa course real del estudiante + bloquea si level no corresponde
 */
studentRouter.get("/grades", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const level = Number(req.query.level || 1);
  const classId = Number(req.query.class_id || 0);

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }
  if (!classId) return res.status(400).json({ error: "class_id requerido" });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  if (!checkLevelAllowed(level, course)) {
    return res.json({
      blocked: true,
      message: "Aún no ha cursado este año.",
      course,
      items: [],
      weighted: null,
    });
  }

  // evaluaciones de esa materia en el course REAL del estudiante
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,title,percent,created_at")
    .eq("id_course", course.id)
    .eq("id_class", classId)
    .order("created_at", { ascending: true });

  if (evalErr) return res.status(500).json({ error: evalErr.message });

  const evaluations = evals || [];
  if (evaluations.length === 0) {
    return res.json({ blocked: false, items: [], weighted: null, course });
  }

  const evalIds = evaluations.map((e) => e.id);

  // notas del estudiante para esos exámenes
  const { data: gradeRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("id_exam,grade,finished_at,attempts,created_at,updated_at")
    .eq("id_student", userId)
    .in("id_exam", evalIds);

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(g.id_exam, g);

  const items = evaluations.map((ev) => {
    const g = gradeMap.get(ev.id) || null;
    return {
      exam_id: ev.id,
      title: ev.title,
      percent: Number(ev.percent ?? 0),
      grade: g ? Number(g.grade ?? 0) : null,
      finished_at: g?.finished_at ?? null,
      attempts: g?.attempts ?? null,
      source: g?.source ?? null,
    };
  });

  let sumW = 0;
  let sum = 0;
  for (const it of items) {
    if (it.grade === null) continue;
    const w = Number(it.percent ?? 0);
    sumW += w;
    sum += it.grade * w;
  }
  const weighted = sumW > 0 ? Number((sum / sumW).toFixed(2)) : null;

  return res.json({ blocked: false, items, weighted, course });
});

studentRouter.get("/etm/tests", requireAuth, async (req, res) => {
  try {
    assertEtmLayerEnv();

    const course = await getStudentCourse(req, res);
    if (!course) return;

    const tests = await fetchClassroomTests();
    console.log(tests)
    const filtered = await filterTestsByStudentCourseLevel(tests, course.level);

    return res.json({
      course,
      items: filtered.map((t) => ({
        testId: t.testId,
        classId: t.classId,
        testTitle: t.testTitle,
        label: t.label,
        takeUrl: t.takeUrl,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error cargando tests ETM" });
  }
});

studentRouter.post("/etm/start", requireAuth, async (req, res) => {
  try {
    assertEtmLayerEnv();

    const { testId, classId, testTitle, cedula, pin } = req.body || {};
    console.log("ReqBody", req.body);
    console.log("TestId:", testId);
    console.log("ClassId:", classId);
    console.log("testiTitle:", testTitle);
    console.log("Cédula:", cedula);
    console.log("pin:", pin);
    if (!testId || !classId || !testTitle || !cedula || !pin) {
      return res.status(400).json({ error: "Faltan campos: testId, classId, testTitle, cedula, pin" });
    }

    // 1) PIN público (lo que el estudiante sabe)
    if (String(pin).trim() !== String(ETM_PUBLIC_PIN).trim()) {
      return res.status(403).json({ error: "Clave del examen incorrecta" });
    }

    // 2) Verifica que la cédula exista (y opcional: que corresponda al usuario autenticado)
    const { data: dbUser, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id,cedula,id_course")
      .eq("cedula", String(cedula).trim())
      .maybeSingle();

    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!dbUser?.id) return res.status(403).json({ error: "La cédula no existe en el sistema" });

    // 🔒 Recomendado: que solo pueda usar SU cédula
    // (si quieres permitir “cualquier cédula válida”, borra este bloque)
    const authUserId = req.auth.user.id;
    if (String(dbUser.id) !== String(authUserId)) {
      return res.status(403).json({ error: "La cédula no corresponde al usuario autenticado" });
    }

    // 3) Valida que el test corresponda al año del estudiante (course.level)
    const course = await getStudentCourse(req, res);
    if (!course) return;

    // class.level debe coincidir con course.level
    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("class")
      .select("id,level")
      .eq("id", Number(classId))
      .maybeSingle();

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (!cls?.id) return res.status(404).json({ error: "La materia (classId) no existe" });
    if (Number(cls.level) !== Number(course.level)) {
      return res.status(403).json({ error: "Ese examen no corresponde a tu año/curso" });
    }

    // 4) Bloqueo por “in progress” (si existe un registro NO graded para ese test + cédula)
    const inProg = await hasInProgressAttempt({
      cedula: String(cedula).trim(),
      classId: Number(classId),
      testTitle: String(testTitle).trim(),
    });

    if (inProg) {
      return res.status(409).json({
        error: "Tienes un intento en progreso o pendiente de calificación para este examen. No puedes iniciar otro.",
      });
    }
    // 5) Inicia el test REAL en ClassroomClipboard, pero usando la clave REAL (env)
    const loadUrl = await startClassroomTestAndGetLoadUrl({
      testId: String(testId),
      cedula: String(cedula).trim(),
    });

    return res.json({ redirectUrl: loadUrl });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error iniciando examen" });
  }
});