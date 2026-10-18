import Link from 'next/link';
import { clienteServidor } from '@/lib/supabase/servidor';
import { supabaseConfigurado, whatsappConfigurado } from '@/lib/entorno';
import { Tienda } from '@/components/Tienda';
import { PantallaConfiguracion } from '@/components/PantallaConfiguracion';
import { Roncito } from '@/components/Roncito';
import type { ProductoCatalogo, Ubicacion } from '@/lib/tipos';

// El catálogo cambia cuando cambia el stock, así que no lo cacheamos:
// mostrar "quedan 3" cuando ya no quedan es peor que tardar 200ms más.
export const dynamic = 'force-dynamic';

export default async function PaginaTienda() {
  if (!supabaseConfigurado) {
    return <PantallaConfiguracion />;
  }

  const supabase = await clienteServidor();

  const [{ data: catalogo, error: errorCatalogo }, { data: ubicaciones }] = await Promise.all([
    supabase
      .from('v_catalogo_publico')
      .select('*')
      .order('categoria')
      .order('producto'),
    supabase
      .from('ubicaciones')
      .select('id, codigo, nombre, tipo, es_punto_recojo')
      .eq('es_punto_recojo', true)
      .eq('activa', true)
      // Por tipo primero: el enum ordena tienda, almacen, feria, así que
      // la tienda física queda como opción por defecto del desplegable.
      .order('tipo')
      .order('nombre'),
  ]);

  if (errorCatalogo) {
    return (
      <PantallaConfiguracion
        error={`No pudimos leer el catálogo: ${errorCatalogo.message}`}
      />
    );
  }

  const productos = (catalogo ?? []) as ProductoCatalogo[];
  const puntos = (ubicaciones ?? []) as Ubicacion[];

  return (
    <>
      <EncabezadoTienda />
      <Tienda
        productos={productos}
        puntosRecojo={puntos}
        whatsappListo={whatsappConfigurado}
      />
      <PieTienda />
    </>
  );
}

function EncabezadoTienda() {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-ron-negro bg-ron-amarillo">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2.5">
          <Roncito tamano={38} animo="normal" className="text-ron-negro" />
          <span className="display text-lg leading-none text-ron-negro sm:text-xl">
            Ron con Cola
            <span className="block whitespace-nowrap text-[0.5rem] font-semibold tracking-[0.12em] opacity-70 sm:text-[0.58rem] sm:tracking-[0.14em]">
              EL BAZAR DE MI PATA
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link href="/mi-pedido" className="boton boton-claro boton-chico">
            Mi pedido
          </Link>
          <Link href="/panel" className="boton boton-oscuro boton-chico">
            Panel
          </Link>
        </nav>
      </div>
    </header>
  );
}

function PieTienda() {
  return (
    <footer className="mt-16 border-t-[3px] border-ron-negro bg-ron-negro px-4 py-10 text-ron-crema">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Roncito tamano={52} animo="contento" className="text-ron-amarillo" />
          <div>
            <p className="display text-xl text-ron-amarillo">Ron con Cola</p>
            <p className="mt-1 max-w-xs text-sm opacity-80">
              Más que una gato tienda, un miauchiverso. Hecho en Perú por humanos
              entrenados y supervisado por un michi.
            </p>
          </div>
        </div>

        <div className="text-sm">
          <p className="display mb-2 text-ron-amarillo">Dónde encontrarnos</p>
          <ul className="space-y-1 opacity-85">
            <li>Tienda 40 — Miraflores, Lima</li>
            <li>Ferias y expos (según temporada)</li>
            <li>
              <a
                href="https://www.instagram.com/ronconcola.pe"
                target="_blank"
                rel="noopener noreferrer"
                className="enlace-ron"
              >
                @ronconcola.pe
              </a>
            </li>
          </ul>
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-6xl text-xs opacity-55">
        El Bazar de mi Pata E.I.R.L. · Los precios y el stock mostrados salen del
        inventario real del sistema.
      </p>
    </footer>
  );
}
