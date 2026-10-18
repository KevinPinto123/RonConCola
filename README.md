# Ron con Cola 🐈‍⬛

**El Bazar de mi Pata E.I.R.L.** — tienda online y panel de control sobre un solo inventario.

> *«¡Yo ya conquisté a los humanos! Ahora déjenlos comprar.»* — Roncito, Michi CEO

Este proyecto resuelve lo que planteaba el pitch de Acelera Digital: el catálogo vivía
en publicaciones de redes, el inventario se adivinaba y las consultas se perdían en el
chat. Aquí la tienda y la administración comparten **la misma base de datos**, así que
lo que ve el cliente es el stock real, y cada venta mueve el inventario una sola vez.

---

## Qué hace

**Para quien compra**
- Catálogo con stock real, búsqueda y filtros por categoría.
- Carrito y pedido con código propio (`RCC-1043`).
- El pedido **se guarda antes** de abrir WhatsApp, y el mensaje ya lleva el código,
  los productos, las cantidades y el total.
- Consulta del estado del pedido con código + teléfono.

**Para quien administra**
- Tablero de indicadores: ventas por día y por canal, ticket promedio, productos
  más vendidos, valor del inventario y alertas de reposición.
- Pedidos: verificar el pago, confirmar, registrar el recojo o cancelar.
- Inventario por ubicación (tienda, almacén, ferias) con ventas presenciales,
  devoluciones, ajustes por conteo y traslados.
- Importación de catálogo por CSV con sugerencia de categoría y detección de
  duplicados, **siempre con revisión humana antes de guardar**.
- Asistente que responde preguntas comerciales con los datos del sistema.

---

## Las reglas que el sistema no deja romper

Están en la base de datos, no en la pantalla. Da igual desde dónde se intente:

| Regla | Cómo se garantiza |
|---|---|
| El stock nunca queda negativo | `CHECK (cantidad >= 0)` y validación en `fn_mover_stock` |
| Nunca hay más reservas que unidades | `CHECK (reservado <= cantidad)` |
| Un pedido descuenta inventario **una sola vez** | Bloqueo de fila + guarda de estado + índice único `uq_mov_venta_online_por_pedido` |
| Dos clientes no compran la última unidad | Reserva al crear el pedido, con `FOR UPDATE` ordenado por variante |
| El precio no lo decide el navegador | `crear_pedido` lee el precio de la base e ignora lo que envíe el cliente |
| Nadie ve ni toca lo que no le toca | RLS en todas las tablas + funciones `SECURITY DEFINER` |
| Un pedido sin pagar no bloquea stock para siempre | `expira_en` + `liberar_reservas_vencidas()` |

Todo esto está **probado**: ver [Pruebas](#pruebas).

---

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **Supabase** — Postgres, Auth y API REST
- **Claude** (opcional) para las sugerencias de catálogo y el asistente

Sin backend propio: la lógica de negocio vive en funciones de Postgres y Next.js
sólo las invoca. Eso evita tener las reglas duplicadas en dos lugares.

---

## Empezar

```bash
npm install
cp .env.example .env.local   # completa los valores
npm run dev
```

El paso a paso completo —incluidas las migraciones y el primer usuario—
está en **[INSTALACION.md](INSTALACION.md)**.

---

## Estructura

```
src/
  app/
    page.tsx                 Tienda pública
    mi-pedido/               Consulta de pedido del cliente
    ingresar/                Acceso del equipo
    panel/                   Panel protegido
      page.tsx                 · Indicadores
      pedidos/                 · Verificar pago, confirmar, recojo
      inventario/              · Stock, movimientos y operaciones
      importar/                · CSV con revisión asistida (admin)
      asistente/               · Preguntas comerciales
      acciones.ts              · Server actions → funciones de Postgres
    api/
      pedidos/                 Crea el pedido y arma el mensaje de WhatsApp
      importar/                Analiza y aplica la importación
      asistente/               Calcula KPIs y los pasa al modelo
  components/                Interfaz
  lib/
    entorno.ts               Variables de entorno y modo demostración
    ia.ts                    Claude + respaldo local determinista
    dinero.ts                Céntimos de sol (enteros, sin coma flotante)
    csv.ts                   Lector de CSV

supabase/
  migrations/                Esquema, funciones, vistas y seguridad
  datos-demo/                Datos FICTICIOS, separados y opcionales
  pruebas/                   Prueba del flujo completo
```

---

## Pruebas

Levanta un Postgres limpio en Docker, aplica las migraciones y verifica el flujo
completo: importación, compra, confirmación, inventario, cancelación, permisos y
analítica.

```bash
bash supabase/pruebas/correr.sh
```

Son **58 comprobaciones**. Entre ellas: que un precio falso enviado desde el
navegador se ignora, que confirmar dos veces un pago no descuenta dos veces, que
un vendedor no puede ajustar inventario y que los números del tablero coinciden
con el cálculo manual.

---

## Modo demostración

El sistema **dice siempre** cuándo le falta una credencial, en vez de simular que
funciona:

| Falta | Qué pasa |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | No arranca. Muestra qué variable falta. |
| `NEXT_PUBLIC_WHATSAPP_NUMERO` | El pedido **se guarda igual** con su código; el botón de WhatsApp queda desactivado y explica por qué. No se inventa un número. |
| `ANTHROPIC_API_KEY` | Las categorías se proponen con reglas de palabras clave y los duplicados con similitud de texto en Postgres. La pantalla lo marca como *modo demostración*. **Los números del tablero no cambian**: se calculan en SQL. |

---

## Datos de demostración

`supabase/datos-demo/semilla.sql` es **ficticio** y opcional. Sirve para probar el
sistema sin cargar el catálogo real. No se aplica en un despliegue normal.
Para borrarlo: `supabase/datos-demo/limpiar.sql`.

---

Hecho en Perú. Los humanos al servicio de Ron. La tecnología al servicio de los humanos.
