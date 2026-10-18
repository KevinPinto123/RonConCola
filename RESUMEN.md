# Resumen honesto del entregable

Qué quedó funcionando, qué está probado y qué falta para que esto esté en vivo.

---

## Lo que está terminado y verificado

El flujo completo del encargo, de punta a punta:

| # | Paso pedido | Estado | Cómo se comprobó |
|---|---|---|---|
| 1 | El administrador inicia sesión | ✅ | Probado en navegador. `/panel` sin sesión redirige a `/ingresar`. |
| 2 | Registra o importa productos (variantes, precios, stock por ubicación) | ✅ | Alta manual en `/panel/productos` + importación CSV. Probado: 9 productos creados desde CSV, con las variantes A4/A3 bajo un mismo SKU. |
| 3 | La IA propone categorías y duplicados; se revisa antes de guardar | ✅ | Probado. Nada entra al catálogo sin aprobación fila por fila. |
| 4 | El cliente consulta el catálogo y crea un pedido | ✅ | Probado en navegador: pedido `RCC-1000`, S/ 55.00. |
| 5 | El pedido se guarda antes de abrir WhatsApp, con su identificador | ✅ | El `POST /api/pedidos` guarda primero y recién después arma el enlace. |
| 6 | El administrador verifica el pago y confirma | ✅ | Probado con referencia `Yape 00458912`. |
| 7 | Descuenta inventario una sola vez y permite registrar el recojo | ✅ | Stock 3 → 2, reserva liberada, **1** movimiento. El segundo intento se rechaza. |
| 8 | Las ventas y movimientos actualizan los indicadores | ✅ | Tablero mostró S/ 97.00 = S/ 55 web + S/ 42 presencial. |
| 9 | El asistente responde con los datos del sistema | ✅ | Probado en modo demostración, con cifras reales del tablero. |

### Cómo se verificó

**58 comprobaciones automáticas** contra un Postgres real (`bash supabase/pruebas/correr.sh`),
más un recorrido manual en navegador de todo el flujo. Las pruebas cubren importación,
compra, confirmación, inventario, cancelación, permisos y analítica.

Casos que se intentaron romper a propósito, y que el sistema rechazó:

- Mandar `precio: 0.01` desde el navegador → cobró S/ 35.00, el precio real de la base.
- Confirmar el pago dos veces → bloqueado; el stock quedó descontado una sola vez.
- Pedir más unidades de las disponibles → bloqueado con el stock exacto que queda.
- Vender más de lo que hay → bloqueado; ninguna fila de inventario quedó en negativo.
- Un vendedor ajustando inventario → bloqueado (es sólo de administración).
- Un visitante anónimo leyendo pedidos o indicadores → bloqueado.
- Consultar el pedido de otra persona con el teléfono equivocado → bloqueado.
- Aplicar dos veces la misma importación → bloqueado.

### Errores encontrados y corregidos durante la construcción

No fueron supuestos: aparecieron al ejecutar y se arreglaron.

1. **CTE que modifica datos invisible en la misma sentencia** — el archivo de demostración
   insertaba productos y variantes en una sola consulta; las variantes no encontraban
   su producto. Se separó en dos sentencias.
2. **Error de hidratación de React** — `toLocaleString` escribe un espacio invisible
   distinto en el servidor y en el navegador. Además usaba la zona del servidor (UTC),
   así que un pedido de las 8 p.m. aparecía al día siguiente. Se reemplazó por
   `src/lib/fechas.ts`, con hora de Lima fija.
3. **Duplicados dentro del propio archivo CSV** — sólo se comparaba contra el catálogo ya
   guardado. Dos filas casi idénticas en el mismo archivo pasaban las dos. Se agregó
   comparación interna, cuidando de no confundir una variante legítima (A4 vs A3) con
   un duplicado.
4. **Gráfico engañoso** — los indicadores devolvían sólo los días con ventas, así que un
   único día vendido se dibujaba como una barra ocupando todo el ancho. Ahora la serie
   trae los 30 días completos.
5. **Alerta de reposición con ruido** — los datos de demostración creaban filas en cero
   para la feria y el panel avisaba de 12 quiebres de stock inexistentes.

---

## Bloqueos pendientes

Tres cosas no pude hacer yo porque requieren credenciales que no tengo. Ninguna es
un problema del código: las tres son de minutos.

### 1. Aplicar las migraciones a tu proyecto de Supabase ⬅ **lo único que bloquea todo**

Tu proyecto `kkbuhwpzbtddptjoleby` **está vacío**: no tiene ni una tabla.

La llave que me diste es la *publishable* (pública, de navegador). Sirve para leer el
catálogo y crear pedidos, pero **no puede crear tablas**: eso necesita la llave secreta
o la contraseña de la base, y ninguna debe compartirse.

**Cómo destrabarlo (2 minutos):** abre Supabase → **SQL Editor** → **New query**, pega
el contenido de **`supabase/INSTALAR_TODO.sql`** y ejecútalo. Es un único archivo con
las cuatro migraciones en orden; ya lo verifiqué contra un Postgres limpio y corre sin
errores. Los avisos `NOTICE … skipping` son normales.

> Si el repositorio ya tiene activa la integración de GitHub con Supabase, al hacer
> `git push` las migraciones de `supabase/migrations/` se aplican solas. Revisa en
> Supabase → Integrations → GitHub si está conectado. Si lo está, salta este paso y
> verifica que las tablas aparezcan.

Después, crea tu usuario (Authentication → Add user, con *Auto Confirm*) y hazlo
administrador con la consulta del paso 5 de `INSTALACION.md`.

### 2. Número de WhatsApp del negocio

Falta `NEXT_PUBLIC_WHATSAPP_NUMERO`. **No lo inventé a propósito**: un número ficticio
mandaría los pedidos de prueba al teléfono de un desconocido.

Mientras falte, el sistema **no se rompe**: el pedido se guarda igual con su código y
la pantalla explica qué variable falta. Cárgalo así (Perú = 51 + número, sólo dígitos):

```
NEXT_PUBLIC_WHATSAPP_NUMERO=51987654321
```

### 3. Llave de Claude (opcional)

Falta `ANTHROPIC_API_KEY`. Sin ella el sistema corre en **modo demostración**, declarado
en pantalla: las categorías se proponen con reglas de palabras clave y los duplicados
con similitud de texto en Postgres.

**Los números del tablero no cambian en absoluto**, porque se calculan en SQL. La IA
sólo redacta. Esa separación es deliberada: así el asistente no puede inventar una venta.

### 4. Publicar en Vercel

No tengo acceso a tu cuenta. El proyecto ya compila para producción (13 rutas, build
limpio). Los pasos están en `INSTALACION.md` §9: importar el repositorio, cargar las
cuatro variables de entorno y desplegar. Vercel detecta Next.js solo.

Después de publicar, agrega tu dominio en Supabase → Authentication → URL Configuration,
o el inicio de sesión del panel fallará en producción.

---

## Decisiones que conviene conocer

**Las reglas viven en la base, no en la pantalla.** Podrías borrar toda la interfaz y
las garantías seguirían en pie. Es a propósito: la llave publicable queda visible en el
navegador de cualquiera, así que lo que protege los datos son las políticas RLS y las
funciones `SECURITY DEFINER`, no el código de React.

**El dinero se guarda en céntimos enteros.** Con decimales, 0.1 + 0.2 no da 0.3 y los
totales dejan de cuadrar con la boleta.

**Los pedidos guardan una copia del precio.** Si mañana sube el precio de una lámina,
el pedido de ayer conserva lo que el cliente aceptó.

**Confirmar el pago es lo que descuenta stock, no crear el pedido.** Crear el pedido
sólo *reserva*. Así dos clientes no compran la última unidad, y un pedido que nunca se
paga no te deja mercadería congelada: a las 48 horas la reserva se libera sola.

**La feria no tiene stock permanente.** Sus filas de inventario se crean cuando
trasladas mercadería para un evento.

---

## Qué no incluye (y no se pidió)

Para que no haya sorpresas: no hay pasarela de pagos en línea (el pago se coordina por
WhatsApp, como opera hoy el negocio), ni emisión de comprobantes electrónicos ante
SUNAT, ni lector de códigos de barras, ni el tablero de producción. El esquema ya
contempla el campo `codigo_barras` en las variantes para cuando toque ese paso.

---

## Arranque rápido

```bash
npm install
cp .env.example .env.local        # completa los valores
# pega supabase/INSTALAR_TODO.sql en el SQL Editor de Supabase
npm run dev
```

Prueba de que todo sigue sano, sin tocar datos reales:

```bash
bash supabase/pruebas/correr.sh
```
