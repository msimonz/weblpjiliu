# Proceso de notas, evaluaciones y promedio del estudiante

**Proyecto:** WebNotas JILIU | La Promesa  
**Audiencia:** administradores del sistema, coordinación académica y usuarios responsables de parametrizar evaluaciones.

Este documento define la lógica funcional esperada para la creación de evaluaciones, registro de notas, cierre automático de exámenes vencidos y cálculo del promedio general del estudiante.

## Objetivo

El sistema debe evitar que una evaluación recién creada afecte el promedio de un estudiante antes de tener una nota real. Una nota real puede originarse por registro manual, por presentación de un examen o por cierre automático de un examen vencido que el estudiante no presentó.

Por ahora no se implementa cierre de materias. El cierre de materias será un proceso posterior.

## Conceptos principales

- **Evaluación:** registro base que define título, tipo, porcentaje, materia o grupo, curso, profesor y datos propios del examen si aplica.
- **Nota:** registro en `grades` asociado a un estudiante y una evaluación.
- **Nota cerrada:** nota que tiene fecha de cierre en `finished_at`. Solo las notas cerradas deben computar en promedios.
- **Evaluación pendiente:** evaluación que todavía no tiene nota cerrada para el estudiante.
- **No presentó:** estado asignado automáticamente a un examen vencido cuando el estudiante nunca lo inició.

## Regla central

Crear una evaluación no debe crear notas.

Al crear una evaluación, el sistema solo debe guardar la información base de la evaluación. No debe crear registros en `grades` para los estudiantes del curso.

## Tipos de evaluación

### Tipo Examen

La nota de un examen se registra por el flujo de presentación del estudiante.

Casos esperados:

1. **Estudiante presenta y envía el examen**
   - El sistema calcula la calificación.
   - Guarda o actualiza `grades`.
   - Define `attempts = 1`.
   - Define `finished_at`.
   - La nota computa para la materia o grupo.

2. **Estudiante inicia el examen pero no lo envía**
   - Al iniciar el examen, el sistema puede crear o asegurar una fila técnica en `grades` con `grade = 0`, porque `rta_examen` depende de esa relación.
   - Esa fila no debe computar mientras no tenga `finished_at`.
   - Si vence el tiempo del examen o se ejecuta el cierre automático, se califica con las respuestas guardadas.
   - Se guarda la nota real obtenida.
   - Define `attempts = 1`.
   - Define `finished_at`.
   - No se muestra como "No presentó", porque el estudiante sí inició el examen.

3. **Estudiante nunca inicia el examen y vence la fecha límite**
   - El cierre automático inserta `grade = 0`.
   - Define `attempts = 0`.
   - Define `finished_at`.
   - Visualmente debe mostrarse "No presentó".
   - Esa nota computa como cero porque ya es un cierre académico real.

4. **Examen sin nota cerrada**
   - Si no existe nota cerrada, se considera pendiente.
   - Visualmente debe mostrarse "—".
   - No computa para promedio.

### Tipo distinto de Examen

Las evaluaciones que no son examen se califican manualmente.

Casos esperados:

1. **Profesor o administrador registra nota**
   - El sistema crea o actualiza `grades`.
   - Guarda `grade`.
   - Actualiza `attempts`.
   - Define `finished_at`.
   - La nota computa para promedio.

2. **Nota no registrada**
   - No debe existir nota automática.
   - La evaluación queda pendiente.
   - Visualmente debe mostrarse "+".
   - No computa para promedio.

## `finished_at` como señal de nota cerrada

Para los cálculos académicos, una nota debe considerarse real solo si tiene `finished_at`.

Reglas:

- Si no existe fila en `grades`, la evaluación está pendiente.
- Si existe fila en `grades` sin `finished_at`, la evaluación está pendiente.
- Si existe fila en `grades` con `finished_at`, la evaluación tiene nota cerrada.
- El promedio solo usa notas cerradas.

Esta regla también protege contra datos antiguos generados automáticamente con `grade = 0` y sin `finished_at`.

## Cierre automático de exámenes vencidos: `closeExpiredExams`

Cada vez que un usuario de cualquier rol ingrese a una opción de consulta de notas, debe ejecutarse un proceso de cierre de exámenes vencidos.

El documento operativo de referencia para este proceso es `docs/cierre-examenes.md`.

### Alcance por rol

- **Estudiante:** el proceso se ejecuta solo para el estudiante autenticado.
- **Administrador, profesor o secretaría:** el proceso se ejecuta solo sobre las evaluaciones, cursos y estudiantes incluidos en la consulta de notas solicitada.

### Reglas de cierre

1. El proceso debe buscar únicamente exámenes:
   - de tipo `Examen`,
   - con programación en `examen_programacion`,
   - vencidos por `fecha_fin`,
   - del curso o alcance consultado,
   - que todavía no tengan nota cerrada para el estudiante.

   Para el cierre automático no es requisito que la programación esté `habilitado = true`; basta con que exista `fecha_fin` y que ya esté vencida.

2. Si el estudiante nunca inició el examen:
   - insertar `grade = 0`,
   - insertar `attempts = 0`,
   - insertar `finished_at`,
   - estado visual: "No presentó".

3. Si el estudiante terminó el examen y existe `rta_examen.finalizado_at`, pero `grades` todavía no está cerrado:
   - sincronizar `grades.grade` con `rta_examen.calificacion`,
   - definir `attempts = 1`,
   - definir `finished_at = rta_examen.finalizado_at`,
   - no recalcular si ya existe nota cerrada.

4. Si el estudiante inició el examen y tiene `rta_examen` sin finalizar:
   - calificar con las respuestas guardadas,
   - guardar esa calificación,
   - definir `attempts = 1`,
   - definir `finished_at`,
   - no marcar como "No presentó".

5. Si existe una fila técnica o heredada en `grades` sin `finished_at` pero no existe `rta_examen`:
   - cerrar la fila conservando la nota que ya tiene,
   - definir `finished_at`,
   - definir `attempts = 0` solo si `attempts` estaba nulo,
   - no sobrescribir automáticamente la nota con cero.

6. Si ya existe `grades.finished_at`:
   - no modificar,
   - no recalcular,
   - no sobrescribir con cero.

### Requisitos de rendimiento e idempotencia

El cierre automático debe ser óptimo:

- procesar solo exámenes vencidos del alcance consultado,
- evitar consultas sobre toda la base,
- evitar duplicados usando la llave natural estudiante/evaluación,
- no reprocesar notas ya cerradas,
- no pisar notas reales ni notas parciales ya cerradas,
- ser seguro si dos usuarios consultan notas al mismo tiempo.

## Cálculo de nota final por materia o grupo

Cada evaluación tiene un porcentaje. Cuando todas las evaluaciones aplicables tienen nota cerrada, la nota final se calcula así:

```text
nota_final = suma(nota_evaluacion * porcentaje_evaluacion / 100)
```

No se debe normalizar sobre porcentajes incompletos. Si falta una evaluación, la materia o grupo está pendiente y no computa.

## Cálculo del promedio general del estudiante

El promedio general se calcula únicamente con unidades académicas completas.

### Materia individual

Una materia individual computa para el promedio general solo cuando todas sus evaluaciones aplicables tienen nota cerrada.

Si una materia tiene evaluaciones pendientes, no computa todavía.

### Grupo de materias

Un grupo de materias computa para el promedio general solo cuando todas sus evaluaciones aplicables tienen nota cerrada.

Si el grupo tiene evaluaciones pendientes, no computa todavía.

### Materias o grupos sin evaluaciones

Una materia o grupo sin evaluaciones no debe computar para promedio. Debe quedar pendiente hasta que existan evaluaciones y todas estén calificadas.

### Promedio general

```text
promedio_general = promedio(simple) de materias individuales completas y grupos completos
```

El promedio general no debe incluir:

- materias pendientes,
- grupos pendientes,
- evaluaciones sin nota,
- filas de `grades` sin `finished_at`,
- evaluaciones recién creadas sin calificación.

## Reglas visuales

Las pantallas de consulta y gestión de notas deben mostrar los estados de forma consistente.

| Caso | Visual |
| --- | --- |
| Nota cerrada menor a 70 | Rojo |
| Nota cerrada mayor o igual a 70 | Negro |
| `grade = 0`, `attempts = 0` y `finished_at` existe | No presentó |
| Examen sin nota cerrada | — |
| Evaluación no examen sin nota cerrada | + |

## Resumen operativo

1. El administrador o profesor crea una evaluación.
2. El sistema guarda solo la evaluación base.
3. Si la evaluación es examen, la nota se genera al presentar el examen o por cierre automático.
4. Si la evaluación no es examen, la nota se genera cuando profesor o administrador la registra manualmente.
5. Las consultas de notas ejecutan cierre automático de exámenes vencidos dentro del alcance consultado.
6. Solo las notas con `finished_at` computan.
7. Una materia o grupo entra al promedio general únicamente cuando todas sus evaluaciones están cerradas.

