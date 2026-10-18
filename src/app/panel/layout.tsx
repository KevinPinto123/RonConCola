import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/supabase/servidor';
import { supabaseConfigurado } from '@/lib/entorno';
import { PantallaConfiguracion } from '@/components/PantallaConfiguracion';
import { NavegacionPanel } from '@/components/NavegacionPanel';
import { cerrarSesion } from '@/app/panel/acciones';
import { Roncito } from '@/components/Roncito';

export const dynamic = 'force-dynamic';

/**
 * Puerta del panel.
 *
 * Sin perfil en la tabla `perfiles` no se entra. Esta es la primera
 * barrera, no la única: aunque alguien se saltara esta pantalla, las
 * políticas RLS y los `fn_exige_equipo()` de la base rechazarían
 * igual cada consulta y cada operación.
 */
export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigurado) return <PantallaConfiguracion />;

  const perfil = await perfilActual();
  if (!perfil) redirect('/ingresar');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b-[3px] border-ron-negro bg-ron-negro text-ron-crema">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/panel" className="flex items-center gap-2.5">
            <Roncito tamano={34} animo="alerta" className="text-ron-amarillo" />
            <span className="display text-base leading-none text-ron-amarillo sm:text-lg">
              Panel Ron con Cola
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <span className="hidden text-right text-xs sm:block">
              <span className="block font-bold">{perfil.nombre}</span>
              <span className="opacity-60">
                {perfil.rol === 'admin' ? 'Administración' : 'Vendedor'}
              </span>
            </span>

            <Link href="/" className="boton boton-claro boton-chico hidden sm:inline-flex">
              Ver tienda
            </Link>

            <form action={cerrarSesion}>
              <button className="boton boton-primario boton-chico" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>

        <NavegacionPanel esAdmin={perfil.rol === 'admin'} />
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
