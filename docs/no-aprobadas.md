# Cálculo de "No Aprobadas"

## ¿Qué representa?

La columna **"No Aprobadas"** indica cuántas materias o grupos de un estudiante tienen una nota (final o parcial) por debajo del umbral de aprobación (**70 puntos**).

La unidad de conteo es la **materia o grupo completo**, no las evaluaciones individuales. Si una materia tiene 4 evaluaciones y el estudiante reprobó 3 de ellas pero el promedio ponderado supera 70, esa materia **no cuenta** como no aprobada.

---

## Umbral de aprobación

El umbral fijo es **70 puntos sobre 100**. Este valor está definido en el backend y se aplica de forma uniforme en todas las pantallas.

---

## Cómo se calcula la nota de cada materia

Cada evaluación tiene un porcentaje (`percent`) que indica su peso dentro de la nota final de la materia. La nota ponderada se calcula así:

```
nota_ponderada = SUMA(nota_evaluacion × percent / 100)
```

**Ejemplo:** Materia con 3 evaluaciones:
| Evaluación | Peso (%) | Nota |
|---|---|---|
| Parcial 1 | 30% | 80 |
| Parcial 2 | 30% | 65 |
| Final | 40% | 75 |

```
nota_ponderada = (80 × 0.30) + (65 × 0.30) + (75 × 0.40)
              = 24 + 19.5 + 30
              = 73.5  → Aprobada
```

---

## Materias completas vs. parciales

### Materia completa
Todas sus evaluaciones tienen nota registrada y cerrada (`finished_at` con valor). La nota ponderada se compara directamente contra 70.

### Materia parcial
Solo algunas evaluaciones están cerradas. En este caso la nota se **normaliza** contra el porcentaje ya evaluado, para tener una lectura proporcional al avance real:

```
porcentaje_evaluado = SUMA(percent de evaluaciones cerradas)
puntos_obtenidos    = SUMA(nota × percent / 100 de evaluaciones cerradas)
nota_normalizada    = (puntos_obtenidos / porcentaje_evaluado) × 100
```

**Ejemplo:** Misma materia, solo 2 de 3 evaluaciones cerradas:
| Evaluación | Peso (%) | Nota | Cerrada |
|---|---|---|---|
| Parcial 1 | 30% | 80 | Sí |
| Parcial 2 | 30% | 50 | Sí |
| Final | 40% | — | No |

```
porcentaje_evaluado = 30 + 30 = 60%
puntos_obtenidos    = (80 × 0.30) + (50 × 0.30) = 24 + 15 = 39
nota_normalizada    = (39 / 60) × 100 = 65  → No Aprobada (parcial)
```

Aunque la nota final todavía puede mejorar, el alumno ya aparece en "No Aprobadas" porque su rendimiento hasta el momento está por debajo de 70.

### Materia sin ninguna evaluación cerrada
No se cuenta ni como aprobada ni como no aprobada. Se ignora en el cálculo.

---

## Resumen de reglas

| Situación | ¿Cuenta como No Aprobada? |
|---|---|
| Ninguna evaluación cerrada | No (se ignora) |
| Parcial cerrada, nota normalizada ≥ 70 | No |
| Parcial cerrada, nota normalizada < 70 | **Sí** |
| Materia completa, nota ponderada ≥ 70 | No |
| Materia completa, nota ponderada < 70 | **Sí** |

---

## Dónde aparece

| Pantalla | Rol | Descripción |
|---|---|---|
| Panel de materias | Estudiante | Tarjeta resumen con conteo de No Aprobadas |
| Grilla de notas | Admin | Columna "No Aprobadas" por alumno |
| Grilla de notas | Secretaría | Columna "No Aprobadas" por alumno |
| Export Excel | Admin | Columna "No Aprobadas" en el archivo descargado |

---

## Relación con "Aprobadas" y "Promedio" (panel estudiante)

En el panel del estudiante las tres tarjetas de resumen funcionan así:

- **Aprobadas**: materias completas con nota ponderada ≥ 70.
- **No Aprobadas**: materias completas con nota ponderada < 70, **más** materias parciales cuya nota normalizada ya está por debajo de 70.
- **Promedio**: promedio simple de las notas ponderadas de las materias **completas** únicamente.

Una materia parcial que aún está por encima de 70 aparece como pendiente y no entra ni en Aprobadas ni en No Aprobadas hasta que se complete o su nota normalizada caiga por debajo del umbral.
