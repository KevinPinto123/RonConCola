import Link from 'next/link';
import { ConsultaPedido } from '@/components/ConsultaPedido';
import { supabaseConfigurado } from '@/lib/entorno';
import { PantallaConfiguracion } from '@/components/PantallaConfiguracion';
import { Roncito } from '@/components/Roncito';

export const metadata = {
  title: 'Consultar mi pedido — Ron con Cola',
};

export default function PaginaMiPedido() {
  if (!supabaseConfigurado) return <PantallaConfiguracion />;

  return (
    <>
      <header className="border-b-[3px] border-ron-negro bg-ron-amarillo">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2.5">
            <Roncito tamano={36} className="text-ron-negro" />
            <span className="display text-lg text-ron-negro">Ron con Cola</span>
          </Link>
          <Link href="/" className="boton boton-claro boton-chico">
            Ir al catálogo
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="display text-2xl">
          <span className="titulo-subrayado">¿Cómo va mi pedido?</span>
        </h1>
        <p className="mt-2 text-sm texto-tenue">
          Escribe el código que te dimos al comprar y el teléfono con el que lo
          hiciste.
        </p>

        <div className="mt-6">
          <ConsultaPedido />
        </div>
      </main>
    </>
  );
}
