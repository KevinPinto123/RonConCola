import { iaConfigurada } from '@/lib/entorno';
import { Asistente } from '@/components/Asistente';

export const dynamic = 'force-dynamic';

export default function PaginaAsistente() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="display text-2xl sm:text-3xl">
          <span className="titulo-subrayado">Preguntar a Roncito</span>
        </h1>
        <p className="mt-1 text-sm texto-tenue">
          Responde sobre ventas, stock y pedidos usando los datos del sistema.
        </p>
      </div>

      <Asistente iaActiva={iaConfigurada} />
    </div>
  );
}
