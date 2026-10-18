'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECCIONES = [
  { href: '/panel', etiqueta: 'Indicadores', icono: '📊', soloAdmin: false },
  { href: '/panel/pedidos', etiqueta: 'Pedidos', icono: '📦', soloAdmin: false },
  { href: '/panel/inventario', etiqueta: 'Inventario', icono: '🏷️', soloAdmin: false },
  { href: '/panel/productos', etiqueta: 'Productos', icono: '🏪', soloAdmin: true },
  { href: '/panel/importar', etiqueta: 'Importar', icono: '📥', soloAdmin: true },
  { href: '/panel/asistente', etiqueta: 'Preguntar a Roncito', icono: '🐈‍⬛', soloAdmin: false },
];

export function NavegacionPanel({ esAdmin }: { esAdmin: boolean }) {
  const ruta = usePathname();

  return (
    <nav className="sin-scrollbar overflow-x-auto border-t-2 border-white/10 bg-ron-negro">
      <ul className="mx-auto flex max-w-7xl gap-1 px-3 py-1.5">
        {SECCIONES.filter((s) => !s.soloAdmin || esAdmin).map((s) => {
          // /panel sólo se marca activo en su ruta exacta; las demás
          // también cuando se está en una subpágina suya.
          const activa = s.href === '/panel' ? ruta === '/panel' : ruta.startsWith(s.href);

          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={activa ? 'page' : undefined}
                className={`display flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                  activa
                    ? 'bg-ron-amarillo text-ron-negro'
                    : 'text-ron-crema/75 hover:bg-white/10 hover:text-ron-crema'
                }`}
              >
                <span aria-hidden>{s.icono}</span>
                {s.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
