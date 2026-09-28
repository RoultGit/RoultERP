/*
 * Logotipo RoultERP.
 *
 * Misma construcción que el de RClass, que es de la misma familia de producto:
 * «Roult» en Bricolage Grotesque 800 y «ERP» en Fraunces 900 cursiva sobre el
 * acento.
 *
 * A diferencia del de allá, aquí el nombre va entero desde el principio. En
 * RClass la R sola se despliega en «Roult» al pasar el cursor, y funciona
 * porque «RClass» ya se lee como una palabra estando plegado. «RERP» no se lee
 * como nada: el logotipo tiene que decir el nombre del producto sin que nadie
 * tenga que pasar el ratón por encima.
 *
 * **Ajuste óptico.** Fraunces tiene las mayúsculas más altas que Bricolage: su
 * E mide alrededor de un 9 % más que la R al mismo tamaño. Por eso «ERP» va a
 * 0.91em, para que las dos alineen arriba.
 */
const bricolage = {
  fontFamily: "var(--font-marca)",
  fontWeight: 800,
  letterSpacing: "-0.04em",
} as const;

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex cursor-default items-baseline leading-none select-none ${className}`}
      role="img"
      aria-label="RoultERP"
    >
      <span aria-hidden style={bricolage}>
        Roult
      </span>

      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-marca-serif)",
          fontWeight: 900,
          fontStyle: "italic",
          letterSpacing: "-0.02em",
          fontSize: "0.91em",
          marginLeft: "0.03em",
          color: "var(--acento)",
        }}
      >
        ERP
      </span>
    </span>
  );
}
