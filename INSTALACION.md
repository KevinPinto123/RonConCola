# Instalación y despliegue

Guía completa, de cero a tienda publicada. Calcula 20–30 minutos la primera vez.

---

## 1. Requisitos

- **Node.js 20 o superior** → `node --version`
- Una cuenta en [supabase.com](https://supabase.com) (el plan gratuito alcanza)
- *(Opcional)* Docker, sólo si quieres correr las pruebas automáticas
- *(Opcional)* Una llave de [console.anthropic.com](https://console.anthropic.com)
  para el asistente con IA

---

## 2. Instalar el proyecto

```bash
npm install
cp .env.example .env.local
```

---

## 3. Preparar la base de datos

Hay dos caminos. El **A** es manual y no necesita instalar nada; el **B** automatiza
los despliegues futuros desde GitHub.

### Camino A — Pegar el SQL en el editor de Supabase

1. Entra a tu proyecto en Supabase → **SQL Editor** → **New query**.
2. Abre, copia y ejecuta **en este orden**, uno por uno:

   | Orden | Archivo | Qué crea |
   |---|---|---|
   | 1 | `supabase/migrations/20261018000001_esquema.sql` | Tablas, tipos e índices |
   | 2 | `supabase/migrations/20261018000002_funciones.sql` | Reglas de negocio |
   | 3 | `supabase/migrations/20261018000003_vistas_kpis_importacion.sql` | Vistas, indicadores, importación |
   | 4 | `supabase/migrations/20261018000004_seguridad.sql` | RLS y permisos |

   Verás varios avisos `NOTICE: ... does not exist, skipping`. **Son normales**:
   los scripts se pueden volver a ejecutar sin romper nada.

3. Carga las ubicaciones del negocio (tienda, almacén, ferias). Si vas a usar los
   datos de demostración, el paso 6 ya las incluye. Si vas directo a producción:

   ```sql
   insert into ubicaciones (codigo, nombre, tipo, es_punto_recojo, activa) values
     ('TIENDA40', 'Tienda 40 — Miraflores', 'tienda',  true,  true),
     ('ALMACEN',  'Almacén central',        'almacen', false, true),
     ('FERIA',    'Feria / Expo',           'feria',   true,  true);
   ```

### Camino B — Con la CLI de Supabase

Las migraciones ya están en `supabase/migrations/` con el formato que espera la CLI.

```bash
npx supabase login
npx supabase link --project-ref TU-PROJECT-REF
npx supabase db push
```

> Como el repositorio está conectado a Supabase, al hacer `git push` las migraciones
> nuevas de esa carpeta se aplican solas. Por eso conviene que todo cambio de
> esquema sea un archivo nuevo ahí, y no una edición de uno ya aplicado.

---

## 4. Configurar las variables de entorno

En Supabase → **Project Settings** → **API**, copia la URL y la llave publicable.
Luego edita `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...

# Número del negocio con código de país, sólo dígitos. Perú = 51 + número.
NEXT_PUBLIC_WHATSAPP_NUMERO=51987654321

# Opcional
ANTHROPIC_API_KEY=sk-ant-...
MODELO_IA=claude-sonnet-5-5
```

> **Sobre la llave publicable:** es pública por diseño y queda visible en el
> navegador. Eso no es una fuga: lo que protege los datos son las políticas RLS y
> las funciones `SECURITY DEFINER` de la migración 004. Con esa llave se puede leer
> el catálogo y crear un pedido; nada más.
>
> La llave **secreta** (`service_role`) no se usa en este proyecto y **no debe**
> ponerse en ninguna variable `NEXT_PUBLIC_*`.

---

## 5. Crear el primer usuario administrador

1. Supabase → **Authentication** → **Users** → **Add user**.
   Marca *Auto Confirm User* para no tener que validar el correo.
2. Conviértelo en administrador desde el **SQL Editor**:

   ```sql
   update perfiles
      set rol = 'admin', nombre = 'Cecilia'
    where id = (select id from auth.users where email = 'tu@correo.com');
   ```

**Roles disponibles**

| Rol | Puede |
|---|---|
| `vendedor` | Ver indicadores, confirmar pagos, registrar recojos y ventas, devoluciones y traslados |
| `admin` | Todo lo anterior + ajustar inventario, importar catálogo y editar productos |

Para dar de alta al resto del equipo, repite el paso 1 y deja el rol en `vendedor`
(es el que se asigna solo).

---

## 6. Datos de demostración *(opcional)*

Para probar el sistema con catálogo de ejemplo antes de cargar el real:

```
Ejecuta supabase/datos-demo/semilla.sql en el SQL Editor
```

⚠️ **Todo ese archivo es ficticio**: productos, precios, costos y cantidades
inventados. No corresponde al catálogo ni a las ventas reales de Ron con Cola.

Para borrarlo después: `supabase/datos-demo/limpiar.sql`.

---

## 7. Levantar el proyecto

```bash
npm run dev
```

| Dirección | Qué es |
|---|---|
| http://localhost:3000 | Tienda |
| http://localhost:3000/mi-pedido | Consulta de pedido del cliente |
| http://localhost:3000/ingresar | Acceso del equipo |
| http://localhost:3000/panel | Panel de administración |

Si falta alguna credencial, la aplicación muestra una pantalla que dice
**exactamente qué variable falta**, en vez de un error genérico.

---

## 8. Probar que todo funciona

Recorrido de 5 minutos que ejercita el flujo completo:

1. **Catálogo** → entra a `/`, agrega productos al carrito.
2. **Pedido** → completa nombre y teléfono, confirma. Anota el código (`RCC-….`).
   Comprueba en `/panel/inventario` que las unidades aparecen como **reservadas**,
   pero el stock físico **no bajó**.
3. **Confirmar el pago** → en `/panel/pedidos`, escribe una referencia y confirma.
   Ahora sí el stock baja, una sola vez.
4. **Intenta confirmar de nuevo** → el sistema lo rechaza.
5. **Recojo** → registra la entrega.
6. **Indicadores** → en `/panel`, la venta ya aparece en el tablero.
7. **Importación** → en `/panel/importar`, sube
   `supabase/datos-demo/catalogo-ejemplo.csv`. Fíjate en que detecta la última fila
   como duplicado de la primera.

### Pruebas automáticas

Con Docker corriendo:

```bash
bash supabase/pruebas/correr.sh
```

Levanta un Postgres limpio, aplica las migraciones y corre 58 comprobaciones sobre
importación, compra, confirmación, inventario, cancelación, permisos y analítica.
**No toca tu base de datos real.**

---

## 9. Publicar

### Vercel (recomendado)

1. Sube el proyecto a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New Project** → importa el repositorio.
3. En **Environment Variables**, carga las mismas cuatro variables de `.env.local`.
   > Las que empiezan con `NEXT_PUBLIC_` deben ir también en *Production*.
4. **Deploy**.

Vercel detecta Next.js solo; no hay que configurar el build.

### Después de publicar

En Supabase → **Authentication** → **URL Configuration**, agrega tu dominio
(`https://tu-tienda.vercel.app`) a *Site URL* y *Redirect URLs*. Sin esto el
inicio de sesión del panel falla en producción.

---

## Problemas frecuentes

**`Could not find the table 'public.productos' in the schema cache`**
Las migraciones no se aplicaron. Vuelve al paso 3. Si acabas de aplicarlas, espera
unos segundos: PostgREST refresca su caché de esquema.

**`Tu usuario no está dado de alta en el equipo de Ron con Cola`**
El usuario existe en Auth pero no en `perfiles`. Revisa el paso 5. Si lo creaste
antes de aplicar las migraciones, el *trigger* no existía todavía:

```sql
insert into perfiles (id, nombre, rol)
select id, split_part(email,'@',1), 'admin' from auth.users
where email = 'tu@correo.com'
on conflict (id) do update set rol = 'admin';
```

**`Alto ahí, humano: esta operación es sólo para el equipo`**
La sesión no tiene perfil, o venció. Vuelve a entrar.

**El botón de WhatsApp aparece desactivado**
Falta `NEXT_PUBLIC_WHATSAPP_NUMERO`. Es a propósito: el pedido se guarda igual, pero
no se inventa un número de destino. Cárgalo y reinicia el servidor.

**Los cambios de `.env.local` no se ven**
Next.js lee las variables al arrancar. Detén el servidor y vuelve a correr
`npm run dev`.
