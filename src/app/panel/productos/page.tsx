import { redirect } from 'next/navigation';
import { clienteServidor, perfilActual } from '@/lib/supabase/servidor';
import { GestorProductos } from '@/components/GestorProductos';
import type { Ubicacion } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export type ProductoAdmin = {
  id: string;
  sku_base: string;
  nombre: string;
  activo: boolean;
  categorias: { nombre: string } | null;
  variantes: {
    id: string;
    sku: string;
    nombre: string;
    precio_centimos: number;
    activa: boolean;
  }[];
};

export default async function PaginaProductos() {
  const perfil = await perfilActual();
  if (perfil?.rol !== 'admin') redirect('/panel');

  const supabase = await clienteServidor();

  const [{ data: productos }, { data: categorias }, { data: ubicaciones }] = await Promise.all([
    supabase
      .from('productos')
      .select(
        `id, sku_base, nombre, activo,
         categorias ( nombre ),
         variantes ( id, sku, nombre, precio_centimos, activa )`,
      )
      .order('nombre'),
    supabase.from('categorias').select('id, nombre').order('orden'),
    supabase
      .from('ubicaciones')
      .select('id, codigo, nombre, tipo, es_punto_recojo')
      .eq('activa', true)
      .order('nombre'),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-2xl sm:text-3xl">
          <span className="titulo-subrayado">Productos</span>
        </h1>
        <p className="mt-1 text-sm texto-tenue">
          Da de alta productos sueltos, cambia precios o sácalos del catálogo.
          Para cargas grandes, usa la importación por CSV.
        </p>
      </div>

      <GestorProductos
        productos={(productos ?? []) as unknown as ProductoAdmin[]}
        categorias={(categorias ?? []) as { id: string; nombre: string }[]}
        ubicaciones={(ubicaciones ?? []) as Ubicacion[]}
      />
    </div>
  );
}
