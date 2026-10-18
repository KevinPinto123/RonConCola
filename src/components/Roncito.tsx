/**
 * Roncito, el Michi CEO.
 *
 * Dibujado como SVG en vez de usar una imagen: así cambia de tamaño sin
 * pixelarse, pesa unos pocos kilobytes y se puede recolorear según el
 * fondo. Sigue el trazo del pitch: silueta negra, ojos grandes y
 * contornos gruesos.
 */

type Props = {
  /** Alto en píxeles */
  tamano?: number;
  /** Expresión según el momento */
  animo?: 'normal' | 'contento' | 'alerta' | 'dormido';
  className?: string;
};

export function Roncito({ tamano = 72, animo = 'normal', className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 120 120"
      height={tamano}
      width={tamano}
      className={className}
      role="img"
      aria-label="Roncito, el gato de Ron con Cola"
      fill="none"
    >
      {/* Cola, levantada con una curva alegre */}
      <path
        d="M92 86c14-2 20-14 15-24-4-8-14-8-17 0-2 6 2 11 7 11"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Cuerpo */}
      <path
        d="M30 104c0-22 8-36 30-36s30 14 30 36z"
        fill="currentColor"
      />
      {/* Cabeza */}
      <circle cx="60" cy="48" r="30" fill="currentColor" />
      {/* Orejas */}
      <path d="M34 28l-4-20 20 11z" fill="currentColor" />
      <path d="M86 28l4-20-20 11z" fill="currentColor" />

      {animo === 'dormido' ? (
        <>
          <path d="M42 48c3 4 9 4 12 0" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M66 48c3 4 9 4 12 0" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* Ojos grandes y blancos, el rasgo que más identifica al michi */}
          <ellipse cx="48" cy="46" rx="9" ry={animo === 'contento' ? 8 : 10} fill="#fff" />
          <ellipse cx="72" cy="46" rx="9" ry={animo === 'contento' ? 8 : 10} fill="#fff" />
          {/* Pupilas: rendija vertical cuando está alerta */}
          <ellipse
            cx="48"
            cy="46"
            rx={animo === 'alerta' ? 2 : 3.5}
            ry={animo === 'alerta' ? 8 : 5}
            fill="currentColor"
          />
          <ellipse
            cx="72"
            cy="46"
            rx={animo === 'alerta' ? 2 : 3.5}
            ry={animo === 'alerta' ? 8 : 5}
            fill="currentColor"
          />
        </>
      )}

      {/* Nariz */}
      <path d="M57 58h6l-3 4z" fill="#fff" />
      {/* Bigotes */}
      <g stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.9">
        <path d="M30 54h10M30 61h10M80 54h10M80 61h10" />
      </g>
    </svg>
  );
}

/**
 * Globo de diálogo de Roncito. Es el recurso que mantiene su voz
 * presente en toda la aplicación sin estorbar la operación.
 */
export function GloboRoncito({
  children,
  animo = 'normal',
  tamano = 56,
  className = '',
}: {
  children: React.ReactNode;
  animo?: Props['animo'];
  tamano?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-3 ${className}`}>
      <Roncito tamano={tamano} animo={animo} className="shrink-0 text-ron-negro" />
      <div className="globo mb-2 text-sm">{children}</div>
    </div>
  );
}
