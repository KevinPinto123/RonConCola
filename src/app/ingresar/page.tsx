import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/supabase/servidor';
import { supabaseConfigurado } from '@/lib/entorno';
import { PantallaConfiguracion } from '@/components/PantallaConfiguracion';
import { FormularioIngreso } from '@/components/FormularioIngreso';
import { Roncito } from '@/components/Roncito';

export const dynamic = 'force-dynamic';

export default async function PaginaIngreso() {
  if (!supabaseConfigurado) return <PantallaConfiguracion />;

  // Si ya hay sesión no tiene sentido mostrar el formulario.
  const perfil = await perfilActual();
  if (perfil) redirect('/panel');

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="tarjeta overflow-hidden">
          <div className="border-b-[3px] border-ron-negro bg-ron-amarillo px-6 py-7 text-center">
            <Roncito tamano={80} animo="alerta" className="mx-auto text-ron-negro" />
            <h1 className="display mt-2 text-2xl">Panel de Ron con Cola</h1>
            <p className="mt-1 text-xs font-bold opacity-70">
              Sólo para humanos autorizados
            </p>
          </div>

          <div className="p-6">
            <FormularioIngreso />
          </div>
        </div>

        <p className="mt-5 text-center text-sm">
          <Link href="/" className="enlace-ron">
            ← Volver a la tienda
          </Link>
        </p>
      </div>
    </main>
  );
}
