import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refresca la sesión en cada navegación.
 *
 * Los tokens de Supabase caducan rápido. Sin esto, el equipo tendría que
 * volver a entrar cada rato en medio de la jornada. Aquí se renuevan y se
 * reescriben las cookies antes de que la página se arme.
 *
 * Ojo: esto NO decide permisos. Quién puede ver o hacer qué lo deciden
 * las políticas RLS y las funciones de la base.
 */
export async function middleware(peticion: NextRequest) {
  let respuesta = NextResponse.next({ request: peticion });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin credenciales la app muestra la pantalla de configuración;
  // no tiene sentido intentar refrescar una sesión que no existe.
  if (!url || !anonKey) return respuesta;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return peticion.cookies.getAll();
      },
      setAll(aGuardar) {
        aGuardar.forEach(({ name, value }) => peticion.cookies.set(name, value));
        respuesta = NextResponse.next({ request: peticion });
        aGuardar.forEach(({ name, value, options }) =>
          respuesta.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();

  return respuesta;
}

export const config = {
  matcher: [
    // Todo menos archivos estáticos e imágenes.
    '/((?!_next/static|_next/image|favicon.ico|marca/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
