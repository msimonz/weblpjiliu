# Proceso de cierre de materias

**Proyecto:** WebNotas JILIU | La Promesa  
**Audiencia:** administradores del sistema, coordinacion academica y responsables de cierre academico.

Este documento define la logica funcional esperada para la opcion administrativa **Cierre Academico**.

El cierre de materias es un proceso diferente al cierre automatico de examenes vencidos. El cierre de examenes sigue documentado en `docs/cierre-examenes.md` y se ejecuta mediante `closeExpiredExams`.

## Objetivo

El sistema debe permitir que un administrador cierre academicamente evaluaciones manuales pendientes dentro de una materia o grupo.

El proceso aplica solo a evaluaciones cuyo tipo sea distinto de `Examen`. Su funcion es cerrar las notas manuales que todavia no tienen `finished_at`, creando o completando registros en `grades` segun corresponda.

El cierre no debe destruir notas validas ya registradas. Si existe una nota parcial valida, el proceso debe conservarla y solo marcarla como cerrada.

## Alcance

El cierre de materias aplica a:

- evaluaciones de tipo distinto de `Examen`,
- evaluaciones asociadas al alcance seleccionado por el administrador,
- estudiantes pertenecientes al curso de la evaluacion,
- filas de `grades` inexistentes, abiertas o inconsistentes.

El cierre de materias no aplica a:

- evaluaciones tipo `Examen`,
- respuestas de examen en `rta_examen`,
- preguntas de examen en `examen_detalle`,
- programaciones de examen en `examen_programacion`,
- notas cerradas validas.

## Disparador

El proceso debe ejecutarse solo por accion explicita del administrador desde la opcion **Cierre Academico**.

La opcion debe estar ubicada en:

```text
Admin > ¿Que quieres hacer? > Gestionar notas > Cierre Academico
```

No debe ejecutarse automaticamente al consultar notas.

## Alcance recomendado de la opcion

La primera version debe permitir cerrar por un alcance controlado:

- `course_id + class_id`,
- o `course_id + group_id`.

No se contempla en la primera version un cierre masivo de todo el año lectivo.

Antes de ejecutar el cierre definitivo, el sistema debe mostrar una vista previa con:

- evaluaciones no examen incluidas,
- estudiantes incluidos,
- notas que se crearian en cero,
- notas abiertas validas que se cerrarian conservando su valor,
- notas abiertas invalidas que se cerrarian con cero,
- notas ya cerradas que no se modificaran,
- evaluaciones tipo `Examen` omitidas.

## Conceptos principales

- **Evaluacion manual:** evaluacion cuyo tipo es distinto de `Examen`.
- **Nota cerrada:** registro en `grades` con `finished_at`.
- **Nota abierta:** registro en `grades` sin `finished_at`.
- **Nota valida:** valor numerico entre 0 y 100.
- **Nota inconsistente:** fila de `grades` sin una nota valida.
- **No Presento:** estado visual para una nota cerrada con `grade = 0`, `attempts = 0` y `finished_at`.

## Regla central

El cierre de materias debe cerrar las evaluaciones manuales pendientes sin modificar notas cerradas validas.

Si no existe una nota valida para el estudiante y la evaluacion, el cierre debe registrar cero y marcar la nota como **No Presento**.

Si existe una nota parcial valida, el cierre debe conservar el valor y solo definir la fecha de cierre.

## Fecha de cierre

El proceso debe calcular una unica fecha/hora de ejecucion al inicio del cierre.

Esa fecha debe usarse como `finished_at` para todas las notas que el proceso cierre en esa ejecucion.

```text
finished_at = fecha_hora_ejecucion_cierre
```

La misma fecha debe aparecer en el resumen de resultado del proceso.

## Reglas de cierre

### 1. Evaluacion tipo `Examen`

Accion:

- ignorar la evaluacion,
- no crear notas,
- no actualizar `grades`,
- no tocar `rta_examen`.

Motivo: los examenes se cierran por el proceso `closeExpiredExams`.

### 2. Evaluacion manual sin fila en `grades`

Caso:

- el estudiante pertenece al curso de la evaluacion,
- la evaluacion es distinta de `Examen`,
- no existe registro en `grades` para estudiante/evaluacion.

Accion:

```text
grade = 0
attempts = 0
finished_at = fecha_cierre
```

Resultado visual:

```text
No Presento
```

### 3. Evaluacion manual con fila abierta y nota valida

Caso:

- existe registro en `grades`,
- `finished_at` esta vacio,
- `grade` es numerico,
- `grade >= 0`,
- `grade <= 100`.

Accion:

```text
grade = valor_existente
attempts = valor_existente_valido_o_1
finished_at = fecha_cierre
```

Reglas:

- no sobrescribir `grade` con cero,
- conservar el valor parcial registrado por profesor o administrador,
- si `attempts` es nulo o invalido, usar `attempts = 1`,
- si `attempts` ya tiene un valor valido, conservarlo.

Resultado visual:

- si `grade = 0` y `attempts = 0`, se muestra **No Presento**,
- si `grade` es mayor que cero, se muestra como nota cerrada normal.

### 4. Evaluacion manual con fila abierta y nota invalida

Caso:

- existe registro en `grades`,
- `finished_at` esta vacio,
- `grade` es `null`,
- o `grade` no es numerico,
- o `grade < 0`,
- o `grade > 100`.

Accion:

```text
grade = 0
attempts = 0
finished_at = fecha_cierre
```

Resultado visual:

```text
No Presento
```

### 5. Evaluacion manual con fila cerrada valida

Caso:

- existe registro en `grades`,
- `finished_at` tiene valor,
- `grade` es numerico entre 0 y 100.

Accion:

- no modificar,
- no recalcular,
- no cambiar `finished_at`,
- no cambiar `attempts`,
- no sobrescribir con cero.

### 6. Evaluacion manual con fila cerrada inconsistente

Caso:

- existe registro en `grades`,
- `finished_at` tiene valor,
- pero `grade` no es una nota valida.

Accion recomendada:

- no corregir automaticamente en la primera version,
- reportar la inconsistencia en el resultado del proceso,
- dejar la correccion para revision manual o para una herramienta administrativa especifica.

Motivo: una nota ya cerrada tiene valor academico y no debe sobrescribirse automaticamente sin trazabilidad adicional.

## Regla visual de "No Presento"

La regla visual de **No Presento** debe ser general para cualquier tipo de evaluacion:

```text
grade = 0
attempts = 0
finished_at existe
```

No debe depender de que la evaluacion sea tipo `Examen`.

Por tanto, una evaluacion manual cerrada por ausencia de nota valida debe verse igual que un examen no presentado.

## Calculo de promedios despues del cierre

Las notas cerradas por este proceso entran al calculo academico normal porque tienen `finished_at`.

Despues del cierre:

- las notas creadas con cero computan como cero,
- las notas parciales validas cerradas computan con su valor conservado,
- las notas ya cerradas siguen computando igual,
- las evaluaciones tipo `Examen` no se ven afectadas.

Si todas las evaluaciones aplicables de una materia o grupo quedan cerradas, esa materia o grupo puede entrar al promedio general del estudiante segun las reglas existentes.

## Idempotencia

El cierre de materias debe ser idempotente.

Si el administrador ejecuta dos veces el cierre sobre el mismo alcance:

- no debe duplicar filas en `grades`,
- no debe modificar notas cerradas validas,
- no debe cambiar `finished_at` de notas cerradas previamente,
- no debe recalcular notas ya cerradas,
- solo debe actuar sobre filas nuevas, abiertas o inconsistentes que aparezcan despues.

La llave natural para evitar duplicados es:

```text
id_student + id_exam
```

## Seguridad academica

El proceso debe cumplir estas reglas:

- procesar solo estudiantes del curso de la evaluacion,
- procesar solo evaluaciones del alcance seleccionado,
- ignorar siempre evaluaciones tipo `Examen`,
- no pisar notas cerradas validas,
- conservar notas abiertas validas,
- cerrar con cero solo cuando no existe nota valida,
- usar una misma fecha de cierre para toda la ejecucion.

## Resultado esperado del proceso

El backend debe devolver un resumen claro para la interfaz administrativa:

```text
fecha_cierre
evaluaciones_procesadas
evaluaciones_examen_omitidas
estudiantes_procesados
notas_creadas_en_cero
notas_abiertas_cerradas_con_valor_existente
notas_abiertas_invalidas_cerradas_en_cero
notas_ya_cerradas_sin_cambio
notas_cerradas_inconsistentes_reportadas
errores
```

La interfaz debe mostrar este resumen al finalizar el cierre.

## Vista previa antes de cerrar

Antes de ejecutar cambios, el sistema debe permitir una vista previa.

La vista previa no debe escribir en base de datos.

Debe informar:

- cuantas evaluaciones manuales se cerrarian,
- cuantas evaluaciones tipo `Examen` se omitiran,
- cuantos estudiantes estan dentro del alcance,
- cuantas notas se crearian con cero,
- cuantas notas abiertas validas se cerrarian conservando valor,
- cuantas notas abiertas invalidas se cerrarian con cero,
- cuantas notas cerradas quedarian sin cambio,
- cuantas inconsistencias cerradas requieren revision manual.

## Endpoints sugeridos

```text
GET /api/admin/subject-closure/preview
POST /api/admin/subject-closure
```

### `GET /api/admin/subject-closure/preview`

Debe calcular el impacto del cierre sin modificar datos.

Filtros esperados:

```text
course_id
class_id
group_id
```

Reglas:

- `course_id` debe ser obligatorio,
- debe enviarse `class_id` o `group_id`,
- no se deben procesar examenes.

### `POST /api/admin/subject-closure`

Debe ejecutar el cierre definitivo sobre el mismo alcance validado en la vista previa.

Body esperado:

```text
course_id
class_id
group_id
confirm = true
```

Reglas:

- `course_id` debe ser obligatorio,
- debe enviarse `class_id` o `group_id`,
- `confirm = true` debe ser obligatorio,
- el proceso debe devolver el resumen de resultado.

## Flujo administrativo

1. El administrador entra a **¿Que quieres hacer? > Gestionar notas > Cierre Academico**.
2. Selecciona curso.
3. Selecciona materia o grupo.
4. El sistema carga la vista previa.
5. El administrador revisa el impacto.
6. El administrador confirma el cierre.
7. El sistema ejecuta el cierre con una unica fecha de cierre.
8. El sistema muestra el resumen final.
9. Las pantallas de notas reflejan las notas cerradas.

## Relacion con otros procesos

- `closeExpiredExams` cierra examenes vencidos.
- **Cierre Academico** cierra evaluaciones manuales.
- Ambos procesos escriben en `grades`.
- Ambos usan `finished_at` como senal de nota cerrada.
- Ambos pueden producir visualmente **No Presento** cuando `grade = 0`, `attempts = 0` y `finished_at` existe.
