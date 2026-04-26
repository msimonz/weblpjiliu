---0--
Desarrolla una funcionalidad de filtros dependientes mediante **4 dropdown lists encadenados**, con la siguiente jerarquía de datos:
**Año → Módulo → Grupo → Materia**
### Reglas funcionales
1. **Estado inicial**
   * Al cargar la pantalla, **solo el dropdown de Año debe estar habilitado**.
   * Los dropdown de **Módulo, Grupo y Materia** deben iniciar **deshabilitados**.
   * El dropdown de **Año** debe mostrar como texto inicial: **"Selecciona año..."**.
2. **Opción "Todos"**
   * Todos los dropdown deben incluir como **primer ítem** la opción:
     **"Todos"**
   * La opción **"Todos"** debe mostrarse **en negrilla**.
   * Los demás elementos de la lista deben mostrarse **sin negrilla**.
3. **Comportamiento dinámico**
   * Al seleccionar un **Año**, deben cargarse y mostrarse los datos correspondientes a ese año.
   * Si en **Año** se selecciona **"Todos"**, se debe mostrar toda la información disponible.
   * Una vez se selecciona un **Año**, se debe **habilitar el dropdown de Módulo**.
   * Una vez se selecciona un **Módulo**, se debe **habilitar el dropdown de Grupo**.
   * Una vez se selecciona un **Grupo**, se debe **habilitar el dropdown de Materia**.
   * Cualquier seleccion o interaccion con los dropdownlist debe actualizar y desplegar la lista de immediato, en la tabla/grilla. 
4. **Dependencia entre dropdowns**
   * Cada dropdown debe mostrar únicamente los elementos que correspondan a la selección vigente de los demás dropdowns.
   * Las listas deben mantenerse **siempre consistentes entre sí**.
   * Si el usuario cambia una selección en cualquier dropdown, los demás dropdowns deben **actualizar automáticamente sus opciones** en función de la nueva combinación de filtros.
   * Los dropdowns deben estar completamente **cableados entre sí**, de forma que cualquier cambio en uno afecte correctamente a los demás.
   * Los dropdownlist deben actulizarse en cascada.
   * Cualquier seleccion o interaccion con los dropdownlist debe actualizar y desplegar la lista de immediato, en la tabla/grilla. 
5. **Lógica de la opción "Todos"**
   * Si se selecciona **"Todos"** en cualquiera de los dropdowns, se debe interpretar como **sin restricción para ese nivel**.
   * En ese caso, se debe mostrar toda la información que cumpla con los filtros activos en los demás dropdowns.
   * Ejemplo:
     * Si Año = 2025, Módulo = "Todos", Grupo = 3, se deben mostrar todos los módulos del año 2025 que correspondan al grupo 3.
   * Si todos los dropdowns están en **"Todos"**, se debe mostrar toda la información disponible.
   * Cualquier seleccion o interaccion con los dropdownlist debe actualizar y desplegar la lista de immediato, en la tabla/grilla. 
6. **Consistencia de datos**
   * En todo momento, las opciones disponibles en cada dropdown deben calcularse según la última selección realizada por el usuario en cualquiera de los filtros.
   * Cualquier seleccion o interaccion con los dropdownlist debe actualizar y desplegar la lista de immediato, en la tabla/grilla. 
### Resultado esperado
Implementar la una interfaz con filtros jerárquicos dependientes, consistentes y dinámicos,todos en la msima linea, donde el usuario pueda navegar y filtrar la información por **Año, Módulo, Grupo y Materia**, 
incluyendo la opción **"Todos"** en cada nivel, con actualización automática y lógica de dependencia bidireccional entre todos los dropdowns.
Cualquier seleccion o interaccion con los dropdownlist debe actualizar y desplegar la lista de immediato, en la tabla/grilla.    
-- FIN de 0--  
--1--
En el módulo de profesor, está la opción para crear/Eliminar Evaluaciones de una materia. Necesitamos que esta misma funcionalidad este disponible en el módulo Admin, dentro del dropdownlist 
¿Qué quieres hacer? y que aparezca como Crear/Eliminar Evaluaciones. Esta opción debe permitir filtrar las materias por nivel, modulo, grupo y materia de la misma manera que se hace en 
“Crear una Materia”. Las evaluaciones se deben poder crear por Modulo, grupo o materia. Si se elige crear evaluación por materia, la opción debe funcional de la misma manera que funciona 
en el módulo de profesor. Si se elije crear por modulo o por grupo, en la tabla “evaluation” de la BD existen los campos id_group y id_module para hacer la relación respectivamente con las tablas 
group y module respectivamente. Al crear una evaluación por grupo debe estar seleccionado el grupo de materias sobre el cual se quiere crear la evaluación y respectivamente con el módulo. 
Se debe permitir entonces, crear evaluaciones por materia individual, por modulo de materias y por grupo de materias.
Dime lo que entendiste para darte el go y puedas ir a realizar los ajustes.
--2--
*Cambiar los botones, por radio botón única selección para elegir el nivel al que se creara la nueva evaluación y los label deben ser: Módulo, Grupo, Materia y en ese orden, seleccionado por default 
 el nivel Materia.
*Si la evaluación a crear es nivel Materia, no requiere profesor responsable.   
*Cambia el label “Curso (para qué estudiantes aplica)” por “Curso”
*Curso y profesor responsable deben verse a la misma altura.
*Tipo, Titulo, %, boton crear y boton cancelar(coloca este nuevo boton) deben ir a la misma altura
--3--
*Poner Nivel, Modulo, Grupo, Materia a la misma altura 	
*Validar las diferentes opciones; si no se ha seleccionado Modulo, Grupo o Materia respectivamente según “Crear evaluación por”, para que no permita avanzar con curso, tipo o título.
*Poner botón cancelar con otro color, revisa los colores del contexto general css.
*Refresca pantalla porque se quedó pegado en l la pantalla el mensaje “Selección un profesor”.
*Cuando creas una evaluación por modulo o por grupo, debe ser al modulo o al grupo, no a las materias de ese modulo o de ese grupo. En la tabla evaluation están los campos id_group y id_module 
 para hacer esa relación.
Dime lo que has entendido para darte el go
--4--
Valida que los porcentajes respeten el máximo de 100% si se crea más de una evaluación, por grupo, modulo o materia.
--5--
Vamos a enlazar esta nueva opción de Admin “Crear/Eliminar Evaluaciones” con el modulo de profesor. Alli en “Ver/Actualizar Evaluaciones” debe aparecen por defecto, en la lista mis evaluaciones, 
todas aquellas evaluaciones de grupo, modulo o materia que tenga asignadas. En la tabla/grilla deben aparecer en la columna materia así: si la evaluación es de nivel materia, deben aparecer tal cual 
actualmente aparecen y se pueden editar. si es que la evaluación es de nivel modulo debe aparecer “Modulo” - nombre del módulo y en la columna “Evaluación” el título de la evaluación de modulo 
y si es que la evaluación es de nivel grupo debe aparecer “Modulo” - nombre del módulo + “Grupo” - nombre del grupo. Las evaluaciones de grupo o modulo no pueden ser modificadas por un profesor, 
este nivel de evaluación de modulo o grupo solo pueden ser editadas desde el módulo admin, a través de la opción “Crear/Eliminar Evaluaciones” que es la opción que veníamos trabajando.
Dime si  lo entiendes para darte el go
--6--
En el modulo admin. Cuando traes las evaluaciones ya existenes, actualmente estas mostrando solo el titulo en la columna “Evaluacion” y % , pero debes mostrar también los datos de  : 
curso, tipo y profesor 
--7--
En el módulo admin. Cuando traes las evaluaciones ya existentes, vamos a permitir que el profesor asignado se pueda modificar. Para ello debes habilitar el campo profesor como una drop downlist 
con los profesores de ese nivel y como default debe aparecer el profesor que ya está asignado. El boton guardar debe guardar los datos de esa evaluación ya existente con los nuevos datos de 
profesor y/o % si es que cambiaron
Dime Que entendiste y te doy el go?
--8--
Revisa en todos los modulos el dropdownlist ¿Que quieres hacer?, debe aparecer por default la leyenda "Que quieres hacer ..."
--9--
organizemos el panel de Admin Crear curso. 
Pon Nivel a la izquierda, enseguida ala misma altura el nombre que ahor debe llamarse "curso" debe ser un dropdownlist, que se llena con los datos del Nivel, si nivel es 1 (Primer año) la lista debe ser 101,102,103,104. Si nivel es 2 (Segundo año) la lista debe ser 201,202,203,404 y asi respectivamente.
a la misma altura year tambien un drop downlist con el años actual (2006) en este caso, y los 2 años subsiguientes. y a la misma alrutra el boton crear y agragra el boton cancelar, que debe limpiar todo cuando se le da click.
Enseguida debe ir la tabla de cursos ya existentes y esa tabla debe tener el nivel en la columna 1 y el curso en la columna 2
--10--
invalid input syntax for type smallint: "2026-01-01" al crear un nuevo curso, el yerar ya no es date ahora es number, debe ir solo el año en numero no fecha. Y del la liita de cursos debes quitar los cursos ya existentes. por ejemplo, ya existe el 101 y ese no deberia salir en la lista de cursos. cuando se crea el curso debe salir de la lista y pasa a los ya exietsntes.
ubica  las columnas (Nivel, curso) de la tabla de cursos ya existentes en el centro de la pantalla, para distribuir la vista de los datos de mejor manera ya que ahora se ve recargado a izquierda y nada a derecha.
--11--
vamos a la opcion "Crear una Materia". Coloca nivel, modulo,grupo , nombre y boton guardar y pon boton cancelar a la misma altura. le boton cancelar refresca la interfaz. En las listas, si el modulo selecionado tiene grupos, esos grupos deben ser los del modulo 
seleccionado. Valida que no se seleccione modulo sin nivel, grupo sin selecionar modulo o nombre sin seleccionar grupo. 
La tabla de materias existentes, organizala nivel,modulo,grupo, materia y esa tabla debe permitir ordenar la tabla por cualquiera de las columnas.  
Revisa lo necesarios y Pideme el go pra ejecutar. 
--12--
vamos a la opcion "Crear un tipo de Evalucion". Coloca boton crear tipo  a la misma altura del tipo y pon boton cancelar, que cancele y refresque todo al darle click. Por la lista de tipos ya existentes en el centro
--13--
*Necesito los scripts querys pra hacer un apso a produccion de las siguientes actividades: 
Crear la tabla level 
Adicionar la columna id_module a la tabla group
Adicionar la columna id_group group al tabal class
Adicionar las columnas id_group, id_module tabla evaluation
*Necesito los inserts para poblar esas nuevas columnas. Tu me das los selects que generan los inserts y yo los ejecuto en la BD de desarrollo.
*Necesito Insert para poblar la tabla class_group, con los mismos datos qeu estan en la BD de desarrollo. Tener en cuanta que en produccion ya hay datos y se debe validar que no se genere una PK violation.
Antes de darme las sentencias, dime lo que has entendido y te doy el go!
--14--
Vamos al panel Admin, opcion Asignar Materias a un profesor. Pon dos list box Año y curso, ambos a la misma altura. la lista de cursos debe corresponder con el año seleccionado. 
Al lado izquierdo de estos pon el boton guardar y otro boton cancelar,tambien a la misma altura. Ya sabes que el boton cancelar hace refresh.
Tener en cuenta que en un mismo año pueden haber mas de un curso del mismo nivel y los profesores se asignan por curso, no por nivel.
Enseguida pon una tabla con dos columnas materia y profesor. 
El encabezado de las columnas debe funcionar  asi: 
El encabezado de materias debe ser un drop down list con la lista de materias del año seleccionado. 
En el dropdown list de encabezado de Materias debes agregar tres items al inicio de la lista:  Todas, Con Profesor, Sin profesor; luego va la lista de materias.
Por defecto debe estar seleccionado el item Todas y en la tabla debe aparecer la lista de todas las materias del año seleccionado. 
Cuando el usuario seleccione  "Con profesor", en la tabla apareceran la materias que tiene profesor asignado, y correspondientemente "Sin Profesor".
Cuando e usuario seleccione una materia especifica, en la tabla aparece esa materia, tenga o no tenga profesor asignado.
El encabezado de Profesor debe ser un drop down list con la lista de todos los profesores. 
En el dropdown list de encabezado de profesor debes agregar tres items al inicio de la lista:  Todos, Con Materias asignadas, Sin Materias asignadas; luego va la lista de profesores.
Por defecto debe estar seleccionado el item Todos y en la tabla debe aparecer la lista de todas las profesores, incluso los que no tengan materias asignadas, caso en el que en la columna materias debe aparecer un guion "--". 
Cuando el usuario seleccione "Con materias asignadas", en la tabla apareceran la materias asignadas que tiene cada profesor con materias  asignadas, y correspondientemente "Sin materias asignadas" aparece las lista de profesores sin materias asignadas y en la columna materia un "--". 
Cuando e usuario seleccione un profesor especifico, en la tabla aparecen el porfesor seleccionado, con sus materias asignadas, y si no tiene asignadas debe aparecer un "--" en la columna Materias.
Las filas de la columna profesor deben ser cada fila un dropdownlist con la lista de todo los profesores, y debe estar seleccionado el profesor asignado a la materaia de la columna Materia.
Ese dropdownlist de cada fila de la columna profesores debe tener un item inicial "--" que aparecerá seleccionado en las materias que no tengan profesor asignado.
Ese dropdownlist de cada fila de la columna profesores permite selecconar el profesor que se va a asignar a la materia de la columna materia, y/o desasignar profesor si se selecciona el item "--"
La mecanica del boton guardar sera que asignar o des asignar rofesores en cada materia, segun este la dupla materia profesor. 
Dime si es claro para ti, y si tenes todos los elementos que necesitas pra implementar, y te doy el go
--15--
Vamos al Panel Admin "Crear Persona".la primera seccion es descargar plantilla con el recuadro tono verde que se ve y pon otro recuadro igual, a la izquierda de este, en el cual agrupes "Subir Excel: Crear Personas"
Cargar Plantilla, en lugar de  "Procesar Excel". El boton Chose file  y el text box que muestar el archivo seleccionado,  y agrega boton cancelar, segun estandar.
En la segunda fila debe aparecer el grupo de objetos de "Crear usuario manual(1)", hay que cambia ese texto por "Crear un usuario". los textbox deben estar a la misma altura y en el siguiente orden: 
nombre,cedula, email, Codigo Jiliu, año,Curso y boton crear y cancelar de acuerdo a estandar. Cedula y Codigo Jiliu deben ser menos anchos que los otros y deben validar que solo acepten numeros. Codigo Jiliu, Año y curso deben aparecer solo si 
en la seleccion de check box esta estudiante en check, si no esta check este deben ocultarse.
Deja los check box por fuera de ese recuadro en el que estan, deja el font sin negrilla y quita los parentesis (S) (T) (A), alinea los checks a la misma altura y ponlos justo despues del titulo "Crear un usuario". 
En la logica de guardar,ten en cuenta que una persona puede tener uno o todos los roles. 
Confirmame el entendido antes de darte el go.
--16--
En el modulo de estudiante, cuando se listan las notas del estudiante y se selecciona el detalle de alguna nota, si esa evaluacion no fue presentada por el estudiante debe salir "no presento" en la columna nota del detalle
La forma de evaluar si un estudiante presentó o no esa evaluacion ya se hace en el modulo  admin->¿Que Quieres hacer?-> "Gestionar Notas de Estudiantes". El "No presento" debe verse de la misma forma que se ve
en el modulo admin->¿Que Quieres hacer?-> "Gestionar  Notas de Estudiantes". 
--17--
Vamos a ordenar la opcion gestionar evaluaciones. la tabla de evaluaciones existentes debe pasa abajo. Curso, tipo, titulo, %, crear y cancelar en una sola linea quitar label "nadaueva evaluación"
--18--
Vamos al modulo estudiante. cuando hago clic en el boton detalle, se abre el detalle de la calificacion y aparece el boton volver. cambia el color de ese botn por naranja y cambiale el tecto por un flecha gruesa hacia la izquierd.
Ten encuenta los modos ligth y dark

     

ADmin > Asignar Materias a un profesor, label "Año" cambiar "Nivel". Adicionar izquierda columna "Modulo". Ttem "Todos" cambiar texto por nombre columna o dropdown. Encabezados de tabla en negrilla.
Siempre tener en cuenta modos Dark y ligth 




