# Financito

Webapp de contabilidad personal de **doble partida** (inspirada en el Plan General Contable) que guarda los datos en una **hoja de Google Sheets privada** del usuario. Funciona en el móvil y se puede instalar como app.

- **Apuntar** con plantillas: gasto, ingreso, traspaso, compra de activo o asiento libre. Cada movimiento es un asiento debe/haber.
- **Mes**: plan de caja al estilo hoja de Excel: ingresos previstos, gastos fijos, reparto a cuentas (plantilla editable, por mes o para siempre), lo que se queda en la cuenta principal y botón para hacer o deshacer el reparto.
- **Informes**: libro diario, libro mayor (cuentas en T y mayor de cada cuenta con su contrapartida), PyG, balance, cierre de saldos con correcciones automáticas y reporte ejecutivo mensual imprimible (2 páginas A4).
- **Gráficos** (icono de la barra superior): periodos libres (semana, mes, trimestre, año, fechas a medida), filtros por categoría, banco e imprevistos, y comparación con el periodo anterior.
- **Inversiones** (icono de la barra superior): seguimiento de posiciones abiertas y vendidas con beneficio, rentabilidad, rentabilidad anualizada y TIR.
- **Automatizaciones**: gastos recurrentes, amortización de activos y cuotas de hipoteca (separa intereses 662 y capital 170). Se generan solas al abrir la app.
- **Datos**: todo vive en tu Google Drive. La app solo pide el permiso `drive.file`, así que solo ve la hoja que ella misma crea.

No hay servidor: es una web estática (GitHub Pages) que habla directamente con la API de Google Sheets usando tu sesión de Google.

## Puesta en marcha

### 1. Publicar en GitHub Pages
1. Sube este repositorio a GitHub (público).
2. *Settings → Pages → Build and deployment*: **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. La app quedará en `https://TU_USUARIO.github.io/financito/`.

### 2. Crear el ID de cliente de Google (una vez, unos 10 minutos)
1. Entra en <https://console.cloud.google.com/> y crea un proyecto nuevo (por ejemplo «Financito»).
2. **APIs y servicios → Biblioteca**: habilita **Google Sheets API** y **Google Drive API**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** (o *Google Auth Platform*):
   - Tipo de usuario: **Externo**. Nombre de la app: «Financito». Tu email como asistencia y contacto.
   - En **Público / Usuarios de prueba**, añade tu cuenta de Gmail.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **Orígenes de JavaScript autorizados**: `https://TU_USUARIO.github.io`
   - **URI de redireccionamiento autorizados**: `https://TU_USUARIO.github.io/financito/`
5. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`) y pégalo en `js/config.js` → `GOOGLE_CLIENT_ID`.

El ID de cliente es público por diseño: sin iniciar sesión con tu cuenta de Google no da acceso a nada.

### 3. Primer uso
1. Abre la app → **Entrar con Google** → acepta el permiso.
2. **Crear hoja**: se crea «Financito · libro contable» en tu Drive con todas las pestañas y el plan de cuentas.
3. *Ajustes → Saldos iniciales*: el saldo de cada cuenta el día que empiezas (asiento de apertura contra la cuenta 100).
4. *Ajustes → Automatizaciones*: revisa y activa las recurrentes (vienen pausadas).
5. En el móvil: menú del navegador → **Añadir a pantalla de inicio**.

## Estructura de la hoja

| Pestaña | Contenido |
|---|---|
| Cuentas | Plan de cuentas: código, nombre, tipo (activo, pasivo, patrimonio, ingreso, gasto), grupo |
| Diario | Libro diario: una fila por apunte (debe, haber, importe). Varias filas con el mismo `asiento` forman un asiento compuesto |
| Recurrentes | Movimientos que se repiten cada mes |
| Activos | Bienes que se amortizan (valor, vida útil en meses, residual) |
| Prestamos | Hipoteca y préstamos (sistema francés) |
| Presupuesto | Límites por categoría: `mes` = `AAAA-MM` o `*` para todos los meses |
| Reparto | Plantilla de reparto mensual (cuenta destino e importe) |
| RepartoMes | Copia del reparto de un mes concreto cuando se cambia o se ejecuta |
| Saldos | Saldos reales anotados al cuadrar bancos |
| Inversiones | Seguimiento de inversiones (fuera de la contabilidad) |
| Config | Ajustes internos |

Puedes editar la hoja a mano; los borrados desde la app son lógicos (columna `borrado`).

## Desarrollo
Es HTML, CSS y JavaScript sin dependencias de compilación. Para probar en local: `python3 -m http.server` y abrir `http://localhost:8000` (el **modo demo** funciona sin Google).
