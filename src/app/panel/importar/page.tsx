import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/supabase/servidor';
import { iaConfigurada } from '@/lib/entorno';
import { ImportadorCsv } from '@/components/ImportadorCsv';

export const dynamic = 'force-dynamic';

export default async function PaginaImportar() {
  const perfil = await perfilActual();

  // Segunda barrera: la primera es el menú, que ni muestra esta sección,
  // y la tercera es fn_exige_admin() dentro de aplicar_importacion().
  if (perfil?.rol !== 'admin') redirect('/panel');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-2xl sm:text-3xl">
          <span className="titulo-subrayado">Importar catálogo</span>
        </h1>
        <p className="mt-1 text-sm texto-tenue">
          Sube un CSV, revisa lo que propone el sistema y recién ahí se guarda.
        </p>
      </div>

      <ImportadorCsv iaActiva={iaConfigurada} />
    </div>
  );
}
