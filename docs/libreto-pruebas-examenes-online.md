# Libreto de Pruebas — Módulo Exámenes Online
**Proyecto:** WebNotas JILIU | La Promesa  
**Fecha:** 2026-04-14  
**Módulo:** Exámenes Online (38 tareas, 9 bloques)

---

## PRE-REQUISITOS
- Las 5 tablas del Bloque 1 ya están en Supabase (`tiempo_minutos` en `evaluation`, `examen_programacion`, `examen_detalle`, `rta_examen`, seed tipo `Examen`)
- Hay al menos un Curso, una Materia y un Estudiante asignado al curso
- Acceso como Admin y como Estudiante

---

## SECCIÓN A — Admin: Crear Examen

| # | Paso | Resultado esperado |
|---|------|--------------------|
| A1 | Login como Admin → seleccionar **Gestionar Evaluaciones** | Vista EVAL_CRUD visible |
| A2 | Elegir Año, Curso, Materia. Seleccionar tipo **Examen** → clic **Crear** | Se abre la pantalla `CrearExamen` (overlay oscuro) |
| A3 | Dejar `tiempo_minutos` vacío → clic **Guardar Examen** | Error: "Tiempo en minutos requerido" |
| A4 | Llenar título, porcentaje (ej. 30%), tiempo (ej. 60 min). Agregar solo 3 preguntas → clic **Guardar** | Error: "Mínimo 4 preguntas" |
| A5 | Agregar 4 preguntas. Poner puntos que sumen 90 → clic **Guardar** | Error: "La suma de puntos debe ser 100" |
| A6 | Corregir puntos a 100 en total (ej. 4 × 25). No marcar respuesta en pregunta 2 → clic **Guardar** | Error: "Pregunta 2: selecciona al menos una respuesta correcta" |
| A7 | Marcar respuestas correctas en todas las preguntas (incluir 1 de cada tipo) → clic **Guardar** | Examen guardado. Overlay se cierra. Toast "✅ Examen creado correctamente" |
| A8 | Clic **Cancelar** en un examen a medio llenar → aparece modal de confirmación | Modal con "Continuar editando" / "Sí, cancelar" |

---

## SECCIÓN B — Admin: Habilitar Examen

| # | Paso | Resultado esperado |
|---|------|--------------------|
| B1 | Seleccionar **Habilitar Exámenes** en el selector de Admin | Vista con grilla vacía y botón "+ Nueva Programación" |
| B2 | Clic **+ Nueva Programación** sin llenar campos → clic **Crear Programación** | Error: "Selecciona un examen" |
| B3 | Seleccionar el examen creado en A7, elegir Curso, llenar Año. Fechas: inicio = ahora, fin = dentro de 2 horas. **No** marcar "Habilitar inmediatamente" → **Crear Programación** | Programación aparece en la grilla con estado "Deshabilitado" |
| B4 | En la grilla, marcar el checkbox de la programación | Estado cambia a "Habilitado". Toast "Examen habilitado" |
| B5 | Clic **Editar fechas** → modificar fecha fin → clic **Guardar** | Fecha actualizada en la grilla |
| B6 | Desmarcar el checkbox → estado vuelve a "Deshabilitado" | Toast "Examen deshabilitado" |
| B7 | Volver a habilitar (checkbox) para continuar las pruebas | Estado: "Habilitado" |

---

## SECCIÓN C — Estudiante: Detección y acceso

| # | Paso | Resultado esperado |
|---|------|--------------------|
| C1 | Login como Estudiante del curso configurado | Dashboard carga |
| C2 | Observar la tabla de materias | La materia del examen muestra botón naranja **"Tomar Examen"** en lugar de "Detalle" |
| C3 | Ir a Admin → deshabilitar el examen (B6) → volver al dashboard del estudiante y recargar | Botón naranja desaparece, vuelve "Detalle" |
| C4 | Volver a habilitar en Admin → recargar dashboard | Botón naranja "Tomar Examen" reaparece |

---

## SECCIÓN D — Estudiante: Tomar Examen

| # | Paso | Resultado esperado |
|---|------|--------------------|
| D1 | Clic **Tomar Examen** | Overlay oscuro con encabezado (Año/Nivel/Curso, Módulo/Materia, Cédula/Nombre), cronómetro en gris, preguntas ocultas, botón **Iniciar** |
| D2 | Verificar encabezado | Datos del estudiante y materia correctos |
| D3 | Clic **Iniciar** | Cronómetro arranca en verde, preguntas aparecen |
| D4 | Responder todas las preguntas, clic **Terminar** | Modal de confirmación: "¿Terminar el examen?" |
| D5 | Clic **Continuar** en el modal | Modal cierra, examen sigue activo |
| D6 | Clic **Terminar** → **Enviar examen** | Examen enviado → abre `VerExamen` |

---

## SECCIÓN E — Estudiante: Ver resultados

| # | Paso | Resultado esperado |
|---|------|--------------------|
| E1 | Pantalla `VerExamen` carga | Encabezado con Cédula/Nombre, Año/Nivel/Curso, Módulo/Materia y **Calificación** (verde ≥70, rojo <70) |
| E2 | Revisar preguntas correctas | Borde izquierdo verde, badge "25/25 pts", opciones con ✓ verde |
| E3 | Revisar preguntas incorrectas | Borde izquierdo rojo, badge "0/25 pts", opción del estudiante en rojo ✗, opción correcta en verde |
| E4 | Revisar pregunta de emparejamiento incorrecta | Par del estudiante en rojo + badge verde con la respuesta correcta |
| E5 | Clic **← Regresar** | Cierra VerExamen, vuelve al dashboard |
| E6 | Observar la tabla de materias | Botón de la materia vuelve a **"Detalle"** (azul). La nota ponderada de la materia se actualizó |

---

## SECCIÓN F — Casos borde

| # | Paso | Resultado esperado |
|---|------|--------------------|
| F1 | Estudiante intenta navegar a `/api/student/exam/:id` de un examen deshabilitado | `403 Examen no disponible para tu curso` |
| F2 | Estudiante ya rindió → intenta abrir el examen de nuevo (manipulando la URL) | `403 Ya has rendido este examen` |
| F3 | Simular timeout: configurar el examen con 1 min, esperar que el cronómetro llegue a 0 | Modal "Se terminó el tiempo ⏰" → clic Aceptar → abre VerExamen |
| F4 | Admin intenta crear examen con porcentaje > 100 | Error de validación frontend |
| F5 | Admin elimina una programación de la grilla | Desaparece de la grilla. Toast "Programación eliminada" |

---

## RESUMEN DEL PLAN (38 tareas)

### BLOQUE 1 — Base de datos ✅
1. `ALTER TABLE evaluation ADD COLUMN tiempo_minutos smallint`
2. `CREATE TABLE examen_programacion`
3. `CREATE TABLE examen_detalle`
4. `CREATE TABLE rta_examen`
5. `INSERT INTO evaluation_type VALUES ('Examen')`

### BLOQUE 2 — Backend Admin (`admin.js`) ✅
6. `POST /api/admin/exams` — crear examen + preguntas
7. `GET /api/admin/exams` — listar exámenes tipo Examen
8. `DELETE /api/admin/exams/:id` — eliminar examen
9. `GET /api/admin/exam-schedules` — listar programaciones
10. `POST /api/admin/exam-schedules` — crear programación
11. `PATCH /api/admin/exam-schedules/:id` — actualizar fechas / habilitar

### BLOQUE 3 — Backend Estudiante (`student.js`) ✅
12. `GET /api/student/exam-available` — exámenes habilitados y vigentes para el curso
13. `GET /api/student/exam/:id_evaluation` — cargar examen sin respuestas correctas
14. `POST /api/student/exam/:id_evaluation/start` — registrar `iniciado_at`
15. `POST /api/student/exam/:id_evaluation/submit` — calificar y guardar resultado
16. `GET /api/student/exam/:id_evaluation/result` — resultado con respuestas correctas

### BLOQUE 4 — Frontend Admin: Crear Examen ✅
17. Tipo=Examen + clic Crear → abre `CrearExamen`
18. Cabecera: título, módulo, materia, curso, porcentaje, `tiempo_minutos`
19. Preguntas dinámicas: `multiple_single`, `multiple_multi`, `falso_verdadero`, `emparejamiento`
20. Validación frontend + botones Guardar / Cancelar con confirmación

### BLOQUE 5 — Frontend Admin: Habilitar Exámenes ✅
21. Nueva opción "Habilitar Exámenes" en el selector de Admin
22. Grilla de programaciones con columnas: Módulo · Materia · Examen · Curso · Fechas · Estado · Acciones
23. Formulario "Nueva Programación"
24. Edición inline de fechas + toggle Habilitar/Deshabilitar

### BLOQUE 6 — Frontend Estudiante: Detección ✅
25. Al cargar dashboard, llamar `/student/exam-available`
26. Materias con examen disponible y sin nota → botón naranja "Tomar Examen"
27. Clic "Tomar Examen" → abre `TomarExamen`

### BLOQUE 7 — Frontend: TomarExamen ✅
28. Cabecera: fila1=Año/Nivel/Curso, fila2=Módulo/Materia, fila3=Cédula/Nombre
29. Cronómetro visible (gris), preguntas ocultas, botón Iniciar
30. Clic Iniciar → `POST /start` → countdown `setInterval` → mostrar preguntas
31. Renderizado de 4 tipos de pregunta en modo editable
32. Countdown llega a 0 → modal "Se terminó el tiempo" → Aceptar → submit → VerExamen
33. Botón Terminar → confirmación → submit → VerExamen

### BLOQUE 8 — Frontend: VerExamen ✅
34. `GET /result` al montar. Cabecera: fila1=Cédula/Nombre, fila2=Año/Nivel/Curso, fila3=Módulo/Materia/Calificación
35. Preguntas read-only: puntos asignados, puntos obtenidos, respuestas verde/rojo
36. Emparejamiento incorrecto: par en rojo + respuesta correcta en verde
37. Botón Regresar → cierra, retorna al dashboard

### BLOQUE 9 — Post-cierre ✅
38. Al regresar de VerExamen: refrescar `exam-available` + `subjects-summary`. Botón retoma azul "Detalle"

---

## DECISIONES DE DISEÑO

| Decisión | Detalle |
|----------|---------|
| Fechas en `examen_programacion` | Soporta n programaciones por examen (no en `evaluation`) |
| Cronómetro | Client-side (`setInterval`) visual + server-side (`iniciado_at`) para validación real |
| Margen de entrega | 30 segundos sobre `tiempo_minutos` para absorber latencia |
| Respuestas correctas | NO se envían al frontend al cargar el examen, solo en `/result` |
| Creación de exámenes | Solo Admin (no Teacher) |
| FK `rta_examen → grades` | Se inserta fila placeholder en `grades` al hacer `/start` |
