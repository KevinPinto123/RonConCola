import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { exigirSupabase } from '@/lib/entorno';

/**
 * Cliente de Supabase del lado del servidor.
 *
 * La sesión del equipo vive en cookies httpOnly: el token nunca queda
 * accesible para scripts del navegador. Cada consulta que hace el panel
 * viaja con el usuario real, así que las políticas RLS y los `es_admin()`
 * de la base se aplican de verdad, sin confiar en lo que diga la interfaz.
 */
export async function clienteServidor() {
  const { url, anonKey } = exigirSupabase();
  const almacen = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return almacen.getAll();
      },
      setAll(aGuardar) {
        try {
          aGuardar.forEach(({ name, value, options }) => {
            almacen.set(name, value, options);
          });
        } catch {
          // Los Server Components no pueden escribir cookies. El middleware
          // ya se encarga de refrescar la sesión, así que aquí se ignora.
        }
      },
    },
  });
}

/**
 * Devuelve el perfil del usuario con sesión, o null.
 * El rol se lee de la base, nunca de la cookie: una cookie se puede
 * manipular, una consulta con RLS no.
 */
export async function perfilActual() {
  const supabase = await clienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('id, nombre, rol')
    .eq('id', user.id)
    .maybeSingle();

  if (!perfil) return null;

  return {
    id: perfil.id as string,
    nombre: perfil.nombre as string,
    rol: perfil.rol as 'admin' | 'vendedor',
    correo: user.email ?? '',
  };
}
