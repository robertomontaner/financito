# Financito: notas para seguir desarrollando

Este documento sirve para que una sesión nueva (persona o Claude) retome el proyecto sin releer el historial. Léelo entero antes de tocar código.

> El repositorio es **público**. Nunca subas datos personales (movimientos reales, saldos, nombres de terceros, importes de nóminas). Los ficheros de migración van fuera del repo; `.gitignore` ya excluye `*.tsv`, `migracion*.json` y `libro-*.json`.

## Qué es

Webapp de contabilidad personal de doble partida, al estilo del PGC español, con estos grupos:
- 1: patrimonio y deudas
- 2: bienes
- 5: bancos
- 6: gastos
- 7: ingresos

Cómo está montada:
- **Sin servidor y sin build.** Es HTML, CSS y JS (módulos ES) servidos por GitHub Pages: <https://robertomontaner.github.io/financito/>.
- **Datos:** una hoja de Google Sheets privada del usuario, a la que se accede con OAuth de Google. El scope es `drive.file`, y la hoja se localiza por la appProperty `financito`.
- **Uso:** sustituye a la base de gastos que el usuario tenía en Notion. Es a la vez formulario para apuntar y visualización.
- **Idioma:** todo en castellano, también los mensajes y comentarios del código.

## Ficheros

| Fichero | Qué hay |
|---|---|
| `index.html` | Esqueleto: topbar, `#view`, barra inferior (Inicio, Mes, +, Movimientos, Informes), `#modal-root`, `#picker-root`, `#toast` |
| `js/config.js` | `GOOGLE_CLIENT_ID` (público por diseño) |
| `js/store.js` | `auth` (OAuth implícito por redirección), `SheetsStore` (API v4 de Sheets), `LocalStore` (modo demo en localStorage `demo_db`) y `seedDemo` |
| `js/model.js` | Esquema `TABLES`, plan de cuentas inicial y la clase `Libro`, con todos los cálculos contables. No toca el DOM |
| `js/app.js` | Toda la interfaz (≈2000 líneas, por secciones; ver mapa abajo) |
| `css/app.css` | Estilos con tokens en `:root` y modo oscuro por `prefers-color-scheme`. Incluye los estilos de impresión del reporte |
| `sw.js` | Service worker: red primero con `cache: 'no-cache'` y caché de respaldo. **Sube el número de `CACHE` (`financito-vN`) en cada cambio publicado** |

### Mapa de `js/app.js`

Las líneas son aproximadas. Busca por el nombre de la función.

- **Utilidades:** `$`, `$$`, `esc`, `toast`, `fail`, `cls`
- **Selector de cuentas:**
  - `pickerField`, `bindPickers` y `openPicker`: hoja con buscador, «más usadas» y «Crear «x»».
  - `emojiFor`: emoji según la cuenta.
- **Datos y formularios:**
  - `reload({automations})` recarga la hoja y rehace `S.libro`. Si se pide, genera las automatizaciones pendientes.
  - `setConfig`, `newEntry(fields)` (fila de Diario), `migrar()`.
  - `formModal`, `fieldHtml`, `readForm`, `openModal`, `closeModal`.
- **Arranque y sesión:**
  - `boot`: si el token ha caducado y ya hubo login, hace un login silencioso con `prompt=none`.
  - `keepSession`: renueva el token 5 minutos antes de caducar si el usuario no está escribiendo, y al volver a la pestaña. Guarda `login_hint` a partir de Drive `about`.
- **Router:** `ROUTES` y `render()`. Las rutas son `inicio`, `mes`, `apuntar`, `diario`, `informes`, `ajustes`, `graficos` e `inversiones`.
  - Las tres últimas cuelgan de iconos de la topbar.
  - `#view.wide` (1180 px) se usa en informes, gráficos e inversiones.
- **Inicio:** `viewInicio`.
- **Apuntar:** `viewApuntar` con plantillas de gasto (con casilla «Imprevisto»), ingreso, traspaso, compra de activo y libre. `editEntry` sirve para editar.
- **Mes (plan de caja):** `viewMes`, `fijoMes` (importe especial solo para un mes), `copiarPlan`, `juntarRepetidas`, `editLinea`, `cfgMes`, `hacerReparto` y `deshacerReparto`.
- **Movimientos:** `viewDiario`.
- **Informes** (`INFORMES`, con ayuda plegable `INF_HELP`):
  - `infLibro`: libro diario; cada asiento es una fila: [fecha + concepto] | debe | haber, con etiqueta Balance o PyG y el sentido del movimiento (sin número de asiento, decisión del usuario).
  - `infMayor`:
    - Vista por defecto: «Sumas y saldos», con emoji, nombre y código del plan en cada cuenta (decisión del usuario).
    - Alternativa: «Cuentas en T», con las cuentas agrupadas por tipo; al tocar un apunte se iluminan sus dos mitades.
  - `mayorCuenta(code)`, el mayor de una cuenta:
    - Vista por defecto «Con su pareja»: cada movimiento con la cuenta del debe y la del haber, con la cuenta propia resaltada. Es lo que el usuario quería.
    - Alternativa: «T clásica».
    - Debajo, tabla con saldo acumulado.
  - `asientoTip` y `bindTips`: tooltip ⓘ con el asiento completo, marcando Balance o PyG y el sentido (`AREA`, `MOVE`).
  - `infPyG`: bloques fijos, variables, imprevistos y financieros, más la fila «Ahorro sin imprevistos». `infBalance` muestra «Dónde ha ido tu ahorro». Las dos tablas llevan € y la cruz de lectura `crosshair` al pasar el ratón.
  - `infCuadre`: «Cierre de saldos». El usuario mete el saldo real de cada banco y se crea un asiento de corrección contra 659/759, o 663/763 en inversiones.
  - `infReporte`: reporte ejecutivo de 2 páginas A4, impreso con `window.print()` y estilos `@media print`.
- **Gráficos** (`viewGraficos`):
  - Filtros:
    - rangos en `RANGOS`, con desplazamiento ‹ ›;
    - categoría y banco;
    - «Con imprevistos», **desactivado por defecto**.
  - Indicadores comparados con el periodo anterior.
  - Contenido:
    - barras de ingresos y gastos;
    - «En qué se va» con barras HTML que filtran al tocar;
    - tipo de gasto apilado;
    - ahorro acumulado;
    - desde dónde pagas;
    - día de la semana;
    - mayores gastos;
    - imprevistos;
    - patrimonio.
  - Paleta categórica fija en `VIZ`, validada para daltonismo. Chart.js 4.4.1 se carga desde cdnjs.
- **Cambio de banco** (`cambioBanco`): asistente que hace el traspaso del saldo y mueve a la cuenta nueva:
  - recurrentes y préstamos;
  - RepartoMes desde ese mes, la plantilla de Reparto y Presupuesto;
  - la cuenta principal o de fondo en Config.

  Al final oculta la cuenta antigua.
- **Inversiones** (`viewInversiones`, `invCalc`, `xirr`, `invTotals`, `editInversion`, `invQuick`): seguimiento aparte de la contabilidad, con t0, v0 y el valor actual o de venta.
  - Calcula beneficio, rentabilidad, CAGR y TIR (XIRR por bisección) de abiertas, cerradas y el total.
- **Ajustes** (`viewAjustes`): agrupa todo lo configurable.
  - **Cuentas:** Mis cuentas (con «⇄ Cambiar de banco…») y Categorías.
  - **Automatizaciones:** `editRecurrente`.
  - **Activos y préstamos:** `editActivo` y `editPrestamo` (este último con `participacion`, la parte del usuario en una hipoteca compartida).
  - **Datos:**
    - `apertura`: saldos iniciales, que fijan Config `inicio`;
    - plan contable avanzado (`editCuenta`);
    - importar y exportar JSON (`importar`, `exportar`).

## Modelo de datos (pestañas de la hoja = `TABLES` en model.js)

- `Diario`: `id, asiento, fecha, concepto, debe, haber, importe, clase, origen, notas, creado, borrado`.
  - Cada fila es un apunte debe/haber por un importe; varias filas con el mismo `asiento` forman un asiento compuesto.
  - El borrado es lógico, con la columna `borrado`.
- `clase`: `corriente`, `imprevisto`, `ingreso`, `traspaso`, `patrimonial`, `amortizacion`, `apertura`, `ajuste` o `historico`.
- `origen` identifica lo generado automáticamente y sirve para que no se duplique:
  - `rec:<id>:AAAA-MM`: recurrente;
  - `amort:<id>:AAAA-MM`: amortización (681 contra 281);
  - `pres:<id>:<n>:i|c`: cuota de préstamo, intereses 662 y capital 170, escalada por `participacion`;
  - `rep:AAAA-MM:<linea>`: traspaso del reparto;
  - `cuadre` y `cambio-banco`;
  - `manual` e `importado`.
- `RepartoMes`: el plan de cada mes, con una fila por línea. `hacia` es la cuenta destino o una fuente de ingreso 7xx.
  - Las filas con `linea = rec:<id>` son **importes especiales de un recurrente solo para ese mes**; un 0 salta el mes.
  - `Reparto` es solo la plantilla antigua que se usa como origen al copiar.
- `Config` (clave/valor):
  - `inicio` es la fecha de apertura; antes de ella solo cuenta la PyG, no los saldos.
  - `cuenta_principal` (por defecto 5721) y `cuenta_fondo` (por defecto 5726).
- `Inversiones`: `id, nombre, tipo, cuenta, fecha_inicio, importe_inicial, valor_actual, fecha_valor, fecha_fin, importe_final, notas, borrado`.
- Las pestañas nuevas se crean solas con `ensureTabs`, y las columnas nuevas se añaden con la migración de cabeceras en `load`. Para añadir una columna basta con añadirla al final del array en `TABLES`.

### Cuentas y convenciones

- `kindOf(c)` devuelve el tipo de cuenta: `dinero` (bancos e inversiones), `bien`, `deuda`, `gasto`, `ingreso` o `contable`.
- Las cuentas de sistema que no salen en las listas del día a día (`SYS`) son:
  - 659 Descuadres y 759 Descuadres a favor;
  - 662 Intereses hipoteca;
  - 663 y 763: pérdidas y ganancias en inversiones;
  - 681 Amortización.
- Cuentas principales:
  - **Patrimonio:** 100 Patrimonio inicial, 119 Histórico sin cuenta (gastos importados sin banco conocido).
  - **Deudas:** 170 Hipoteca.
  - **Bienes:** 211 a 218, y 281 Amortización acumulada.
  - **Inversiones:** 540 Trade Republic.
  - **Bancos:** 5701 Efectivo, 5721 Mediolanum, 5722 a 5726 (Revoluts y Openbank).
  - **Gastos:** 600 a 605 variables, y 620, 625, 629 y 6291 fijos (grupo «Gastos fijos»).
  - **Ingresos:** 700 Nómina, 705 Cuenta propia, 706 Comisiones, 707 Cheques Amazon, 778 Excepcionales.
- `Libro.bloque(code, imprevisto)` devuelve `ingresos`, `fijos`, `variables`, `imprevistos` o `financieros`.
- Los imprevistos son gastos con `clase = imprevisto`. Se reparten así:
  - **Sí cuentan** en la PyG, en su propio bloque.
  - **No cuentan** en el «gasto corriente», en los límites ni, por defecto, en Gráficos.
- **Dos criterios que no hay que mezclar:**
  - **Mes = caja.** El reparto son traspasos desde la cuenta principal y no tocan la PyG.
  - **Informes = contable.** El diario pasa al mayor; la PyG sale de los grupos 6 y 7, y el balance de los grupos 1 a 5.

## Cómo probar

No hay tests automáticos. Se prueba con Playwright, que ya está instalado en el contenedor, sobre el **modo demo**:

```bash
cd financito && (python3 -m http.server 8766 >/dev/null 2>&1 &) ; sleep 1
# script node con require('playwright'): ir a localhost:8766, localStorage.clear(), click '#demo', navegar por hash
pkill -f "http.server 8766"
```

- El servidor muere entre comandos, así que hay que arrancarlo dentro del mismo comando.
- cdnjs está bloqueado en el sandbox. Para ver los gráficos se instala `npm i chart.js@4.4.1` en una carpeta temporal y en Playwright se hace `context.route('**/cdnjs.cloudflare.com/**', …)` sirviendo `dist/chart.umd.js`.
- Para el reporte se usa `page.emulateMedia({media:'print'})` y `page.pdf({format:'A4'})`. Hay que comprobar que salen 2 páginas.
- Antes de publicar: `node --check js/app.js`.

## Publicar

Hacer push a `main` en `robertomontaner/financito`; GitHub Pages despliega en un minuto. Hay que subir `CACHE` en `sw.js` cada vez. La app se recarga sola cuando hay versión nueva.

## Decisiones tomadas con el usuario (no deshacer sin preguntar)

- **Bancos y categorías:** las cuentas bancarias van separadas de las categorías del plan contable en todas las pantallas. El selector de cuentas es una hoja con emojis y buscador.
- **Mes:**
  - Cada mes tiene su propio plan; un mes nuevo se empieza copiando el anterior y los cambios solo afectan a ese mes. El usuario rechazó una plantilla global tipo «mi reparto 2026».
  - Lo que sobra se queda en la cuenta principal, que es configurable.
  - Los ingresos se separan por fuentes.
  - En los recurrentes, un importe distinto un mes concreto se pone desde Mes → tocar el fijo («solo este mes»).
- **Hipoteca compartida:** al 50 % u otro porcentaje, mediante `participacion`.
- **Libro mayor:** en el mayor de una cuenta, el usuario quiere ver el par completo (el gasto en el debe y el banco que baja en el haber). Por eso «Con su pareja» es la vista por defecto, y la T clásica es la opción secundaria.
- **Formato y gráficos:**
  - Las tablas de PyG y Balance llevan €.
  - Gráficos se muestra sin imprevistos por defecto.
  - Gráficos e Inversiones se abren desde la topbar, no desde la barra inferior.
- **Imprevistos:** se quedan como gasto con clase, sin provisión. La opción de «provisión» con una cuota mensual en Ajustes se ofreció y quedó sin decidir.
- **Login:** se mantiene Google con renovación silenciosa. La alternativa de un login propio (Apps Script pegado a la hoja con contraseña) se ofreció; el usuario la valorará si la renovación le molesta.

## Pendiente o ideas

1. **Reset de ingresos y gastos.** El usuario pasará los datos completos de 2025 y 2026 para hacer un borrón y cuenta nueva del Diario y reimportarlo limpio con Ajustes → Importar, con JSON `{ "Diario": [...] }`.
   - Hay que mapear cada gasto a su banco real, porque los que no tienen banco caen en 119.
   - Después habrá que fijar los saldos iniciales.
   - Datos actuales sospechosos: Revolut Ana tenía un saldo negativo porque faltan entradas, y hay 7 extraordinarios contra 119.
2. Opcional: un login con Apps Script y contraseña propia.
3. Opcional: provisión de imprevistos.
4. Opcional: una tarea programada que genere o envíe el reporte del mes anterior cada día 1.
