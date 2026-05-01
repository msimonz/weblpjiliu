# Proceso de Cierre de Exámenes — `closeExpiredExams`

## ¿Qué es?

`closeExpiredExams` es el proceso automático que detecta exámenes vencidos y registra el resultado final de cada estudiante. Se ejecuta en el backend cada vez que alguien consulta notas, garantizando que ningún examen quede abierto indefinidamente en la base de datos.

---

## ¿Cuándo se dispara?

El proceso se activa automáticamente al consultar notas desde cualquier rol:

| Pantalla | Rol | Ruta API |
|---|---|---|
| Panel de materias | Estudiante | `GET /api/student/subjects-summary` |
| Detalle de notas de una materia | Estudiante | `GET /api/student/grades` |
| Grilla de notas por materia | Profesor | `GET /api/teacher/class-grade-grid` |
| Grilla de notas por grupo | Profesor | `GET /api/teacher/group-grade-grid` |
| Lote de grillas | Profesor | `GET /api/teacher/grade-grids-batch` |
| Notas de un examen específico | Profesor | `GET /api/teacher/exam-grades` |
| Grilla por materia | Admin / Secretaría | `GET /api/admin/class-grade-grid` |
| Grilla por grupo | Admin / Secretaría | `GET /api/admin/group-grade-grid` |
| Grilla consolidada | Admin / Secretaría | `GET /api/admin/grade-grid` |
| Notas de un examen específico | Admin | `GET /api/admin/exam-grades` |

**No existe un cron job**: el cierre es bajo demanda, se ejecuta cada vez que alguien abre una pantalla de notas.

---

## ¿Qué exámenes procesa?

El proceso busca registros en la tabla `examen_programacion` donde:

- `fecha_fin < ahora` (el plazo ya venció)
- `fecha_fin` no es nulo

**No importa si `habilitado` es `true` o `false`**: basta con que `fecha_fin` sea pasada para que el examen se considere vencido.

---

## Lógica de cierre por estudiante

Para cada examen vencido y cada estudiante del curso correspondiente, el proceso evalúa el estado del estudiante y actúa según el caso:

### Caso 1 — Ya tiene nota cerrada (`grades.finished_at` tiene valor)
**Acción:** No hace nada. La nota ya fue registrada y no se modifica.

### Caso 2 — No presentó (sin `rta_examen`, sin `grades`)
El estudiante nunca abrió el examen y no tiene ningún registro.

**Acción:** Inserta en `grades`:
```
grade      = 0
attempts   = 0
finished_at = ahora
```

### Caso 3 — Tiene `rta_examen` finalizado pero `grades` sin `finished_at`
El estudiante terminó el examen (hay registro en `rta_examen` con `finalizado_at`) pero la nota no quedó sincronizada en `grades`.

**Acción:** Actualiza `grades` con la calificación ya calculada en `rta_examen`:
```
grade      = rta_examen.calificacion
attempts   = 1
finished_at = rta_examen.finalizado_at
```

### Caso 4 — Inició pero no terminó (`rta_examen` sin `finalizado_at`)
El estudiante abrió el examen, guardó algunas respuestas, pero nunca lo envió antes de que venciera el plazo.

**Acción:** Califica con las respuestas guardadas hasta ese momento y cierra:
```
grade      = calificación calculada con respuestas parciales
attempts   = 1
finished_at = ahora
```

### Caso 5 — Tiene `grades` sin `finished_at` y sin `rta_examen`
Fila técnica o heredada (por ejemplo, cargada manualmente) sin fecha de cierre.

**Acción:** Cierra la fila conservando la nota que ya tiene:
```
grade      = (sin cambio)
attempts   = 0 si era nulo, (sin cambio si ya tenía valor)
finished_at = ahora
```

---

## Condición para que el proceso funcione correctamente

Para que `closeExpiredExams` pueda procesar un examen, **debe existir un registro en `examen_programacion`** con:
- `id_evaluation` apuntando al examen correcto
- `id_course` apuntando al curso correcto
- `fecha_fin` en el pasado

Si el examen fue cargado en lote (sin pasar por el flujo de programación), hay que crear manualmente el registro en `examen_programacion` con `habilitado = false` y `fecha_fin` en el pasado para que el proceso lo detecte.

Si `id_course` está apuntando al curso incorrecto, los estudiantes del curso correcto nunca serán procesados y seguirán mostrando `—` en la grilla.

---

## Visualización en la interfaz

### Panel del estudiante

| Estado | Lo que ve el estudiante | Condición |
|---|---|---|
| Examen disponible | Botón naranja **"Tomar Examen"** | Existe programación activa y no ha sido presentado |
| Nota final | Nota en color (verde ≥ 70, rojo < 70) | `grades.finished_at` existe y `complete = true` |
| Nota parcial | Nota en gris (opacidad baja), botón **"Detalle"** en gris | Hay notas pero el curso no está completo |
| Sin nota | `—` | No hay ningún registro en `grades` |

### Grilla del profesor / admin / secretaría

| Estado | Lo que ve en la celda | Condición |
|---|---|---|
| Nota registrada | Número (ej. `85.00`) | `grades.finished_at` existe |
| No presentó | Badge rojo **"No Presentó"** | `finished_at` existe, `grade = 0`, `attempts = 0` |
| Pendiente | `—` | No existe registro en `grades` |

---

## Errores comunes y cómo diagnosticarlos

### El alumno aparece como pendiente (`—`) y el examen ya venció

1. Verificar que existe un registro en `examen_programacion` para ese examen y ese curso:
```sql
SELECT ep.id, ep.id_evaluation, ep.id_course, ep.fecha_fin, ep.habilitado
FROM examen_programacion ep
JOIN evaluation e ON e.id = ep.id_evaluation
WHERE e.title ILIKE '%nombre del examen%';
```

2. Confirmar que `id_course` corresponde al curso del alumno.

3. Confirmar que `fecha_fin < now()`.

### El examen vencido no tiene `examen_programacion`

Crear el registro manualmente:
```sql
INSERT INTO examen_programacion (id_evaluation, id_course, year, fecha_ini, fecha_fin, fecha_limite_ver, habilitado)
SELECT
  e.id, e.id_course, c.year,
  e.created_at, e.created_at,
  e.created_at + INTERVAL '5 days',
  false
FROM evaluation e
JOIN course c ON c.id = e.id_course
WHERE e.id = <id_evaluation>;
```

Luego recargar la grilla de notas para disparar el cierre automático.
