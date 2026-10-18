import type { Metadata, Viewport } from 'next';
import { Fredoka, Nunito } from 'next/font/google';
import './globals.css';

// Fredoka para títulos (redonda y gruesa, como el logo del pitch)
// y Nunito para los textos largos, que se lee cómoda en el celular.
const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--fuente-display',
  display: 'swap',
});

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--fuente-cuerpo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ron con Cola — Más que una gato tienda, un miauchiverso',
  description:
    'Tienda online y control de inventario de Ron con Cola · El Bazar de mi Pata E.I.R.L. ' +
    'Productos con temática de gatos, hechos en Perú.',
  openGraph: {
    title: 'Ron con Cola — Tienda para humanos entrenados',
    description: 'Catálogo con stock real, pedidos por WhatsApp y recojo en tienda.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffc800',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PE" className={`${fredoka.variable} ${nunito.variable}`}>
      <head>
        {/* Las variables de next/font alimentan los tokens de Tailwind */}
        <style>{`
          :root {
            --font-display: var(--fuente-display), "Trebuchet MS", system-ui, sans-serif;
            --font-cuerpo: var(--fuente-cuerpo), system-ui, sans-serif;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
