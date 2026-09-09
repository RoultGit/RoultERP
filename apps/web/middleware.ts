import { NextResponse, type NextRequest } from "next/server";

/**
 * Cabeceras de seguridad y guardia de sesión.
 *
 * El middleware **no** valida la sesión contra la base de datos: sólo mira si
 * hay cookie. La validación de verdad ocurre en cada página con `exigirSesion`.
 * Es deliberado — el middleware corre en el runtime Edge, donde no hay conexión
 * a Postgres, y una guardia que dependiera de él sería una guardia que se cae
 * si alguien cambia el `matcher`. Aquí sólo se ahorra un viaje al servidor a
 * quien evidentemente no ha entrado.
 *
 * La CSP usa nonce en vez de 'unsafe-inline'. Cuesta un poco más porque hay que
 * propagar el nonce a los scripts de Next, pero 'unsafe-inline' desactiva
 * justamente aquello para lo que existe la CSP.
 */

const RUTAS_PUBLICAS = [
  "/entrar",
  "/recuperar",
  "/restablecer",
  "/invitacion",
];

function csp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    // En desarrollo, Next inyecta eval para el refresco en caliente.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Next inyecta estilos en línea; no hay nonce que valga para ellos.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // El sistema no llama a terceros. Si algún día se integra con SUNAT desde
    // el navegador —no debería: eso va por el servidor— habrá que abrirlo aquí.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const dev = process.env.NODE_ENV !== "production";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const cabeceras = new Headers(req.headers);
  cabeceras.set("x-nonce", nonce);

  const { pathname } = req.nextUrl;
  const esPublica = RUTAS_PUBLICAS.some((r) => pathname.startsWith(r));
  const tieneCookie = req.cookies.has("rt_sesion");

  let res: NextResponse;
  if (!esPublica && !tieneCookie) {
    const destino = req.nextUrl.clone();
    destino.pathname = "/entrar";
    // Se recuerda a dónde iba para devolverlo ahí tras entrar.
    if (pathname !== "/") destino.searchParams.set("siguiente", pathname);
    res = NextResponse.redirect(destino);
  } else {
    res = NextResponse.next({ request: { headers: cabeceras } });
  }

  res.headers.set("Content-Security-Policy", csp(nonce, dev));
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!dev) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return res;
}

export const config = {
  matcher: [
    // Todo menos los archivos estáticos y el favicon.
    { source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)" },
  ],
};
