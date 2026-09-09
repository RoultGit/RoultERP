import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/sesion";

export default async function Inicio() {
  const s = await sesionActual();
  if (!s) redirect("/entrar");
  redirect(s.empresaId ? "/tablero" : "/empresas");
}
