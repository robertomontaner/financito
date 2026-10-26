# Financito

Webapp de contabilidad personal de **doble partida** (inspirada en el Plan General Contable) que guarda los datos en una **hoja de Google Sheets privada** del usuario. Funciona en el móvil y se puede instalar como app.

- **Apuntar** con plantillas: gasto, ingreso, traspaso, compra de activo o asiento libre. Cada movimiento es un asiento debe/haber.
- **Informes**: PyG mensual, balance mes a mes (con comprobación de cuadre), gráficos, sobres de presupuesto y cuadre con el saldo real de los bancos.
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
| Presupuesto | Sobres: `mes` = `AAAA-MM` o `*` para todos los meses |
| Saldos | Saldos reales anotados al cuadrar bancos |
| Config | Ajustes internos |

Puedes editar la hoja a mano; los borrados desde la app son lógicos (columna `borrado`).

## Desarrollo
Es HTML, CSS y JavaScript sin dependencias de compilación. Para probar en local: `python3 -m http.server` y abrir `http://localhost:8000` (el **modo demo** funciona sin Google).
