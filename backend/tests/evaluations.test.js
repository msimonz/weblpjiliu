import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { supabaseAdmin } from "../src/supabase.js";

const app = createApp();

// IDs de datos reales en DEV — ajusta si cambian
const TEST_LEVEL    = 1;
const TEST_COURSE_ID = null; // null = no filtrar por curso en algunos tests
const TEST_MODULE_ID = 1;
const TEST_GROUP_ID  = 22;

// IDs de evaluaciones creadas durante el test (para limpiar después)
const createdIds = [];

// ── GET /api/admin/evaluations ────────────────────────────────────────────────
describe("GET /api/admin/evaluations", () => {

  it("devuelve lista sin filtros", async () => {
    const res = await request(app).get("/api/admin/evaluations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("filtra por nivel (level=1)", async () => {
    const res = await request(app).get("/api/admin/evaluations?level=1");
    expect(res.status).toBe(200);
    const items = res.body.items;
    expect(items.length).toBeGreaterThan(0);
    // Todas deben ser de nivel 1: via class.level o course.level
    items.forEach((ev) => {
      const lvl = ev.class?.level ?? ev.course?.level;
      expect(Number(lvl)).toBe(1);
    });
  });

  it("filtra por módulo (module_id)", async () => {
    const res = await request(app).get(`/api/admin/evaluations?module_id=${TEST_MODULE_ID}`);
    expect(res.status).toBe(200);
    res.body.items.forEach((ev) => {
      const mod = ev.id_module ?? ev.class?.id_module;
      expect(String(mod)).toBe(String(TEST_MODULE_ID));
    });
  });

  it("filtra por grupo (group_id)", async () => {
    const res = await request(app).get(`/api/admin/evaluations?group_id=${TEST_GROUP_ID}`);
    expect(res.status).toBe(200);
    res.body.items.forEach((ev) => {
      expect(String(ev.id_group)).toBe(String(TEST_GROUP_ID));
    });
  });

});

// ── POST /api/admin/evaluations ───────────────────────────────────────────────
describe("POST /api/admin/evaluations", () => {

  let testCourseId;
  let testClassId;

  beforeAll(async () => {
    // Buscar un curso y materia de nivel 1 para usar en los tests
    const { data: courses } = await supabaseAdmin
      .from("course").select("id,level").eq("level", TEST_LEVEL).limit(1);
    testCourseId = courses?.[0]?.id;

    const { data: classes } = await supabaseAdmin
      .from("class").select("id,level,id_module,id_group").eq("level", TEST_LEVEL).limit(1);
    testClassId = classes?.[0]?.id;
  });

  afterAll(async () => {
    // Limpiar evaluaciones creadas durante los tests
    if (createdIds.length > 0) {
      await supabaseAdmin.from("evaluation").delete().in("id", createdIds);
    }
  });

  it("crea evaluación por materia con id_module e id_group", async () => {
    if (!testCourseId || !testClassId) return; // skip si no hay datos

    const res = await request(app)
      .post("/api/admin/evaluations")
      .send({
        id_course:  testCourseId,
        id_class:   testClassId,
        id_teacher: "test-admin-uuid",
        percent:    20,
        title:      "Test evaluación automática",
        id_type:    1,
      });

    expect(res.status).toBe(200);
    expect(res.body.item).toBeDefined();

    const id = res.body.item.id;
    createdIds.push(id);

    // Verificar que se guardó id_module e id_group
    const { data: ev } = await supabaseAdmin
      .from("evaluation").select("id_module,id_group").eq("id", id).maybeSingle();

    expect(ev?.id_module).not.toBeNull();
    expect(ev?.id_group).not.toBeNull();
  });

  it("rechaza si el porcentaje supera 100", async () => {
    if (!testCourseId || !testClassId) return;

    const res = await request(app)
      .post("/api/admin/evaluations")
      .send({
        id_course:  testCourseId,
        id_class:   testClassId,
        id_teacher: "test-admin-uuid",
        percent:    150,
        title:      "Test inválido",
        id_type:    1,
      });

    expect(res.status).toBe(400);
  });

  it("rechaza si faltan campos obligatorios", async () => {
    const res = await request(app)
      .post("/api/admin/evaluations")
      .send({ percent: 20, title: "Sin curso ni materia" });

    expect(res.status).toBe(400);
  });

});

// ── GET /api/admin/teachers ───────────────────────────────────────────────────
describe("GET /api/admin/teachers", () => {

  it("devuelve todos los profesores sin filtro", async () => {
    const res = await request(app).get("/api/admin/teachers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("filtra profesores por nivel", async () => {
    const all  = await request(app).get("/api/admin/teachers");
    const byLv = await request(app).get(`/api/admin/teachers?level=${TEST_LEVEL}`);
    expect(byLv.status).toBe(200);
    // La lista filtrada no puede tener más profesores que la total
    expect(byLv.body.items.length).toBeLessThanOrEqual(all.body.items.length);
  });

  it("filtra profesores por módulo", async () => {
    const res = await request(app).get(`/api/admin/teachers?module_id=${TEST_MODULE_ID}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

});
