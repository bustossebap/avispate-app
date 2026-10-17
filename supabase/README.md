# Nube de AVISPATE · Etapa 10 (avisos con la app cerrada)

Supabase hace tres cosas y ninguna cuesta un peso: guarda la suscripción de cada teléfono, guarda la
cola de avisos que el teléfono calculó y, cada minuto, llama a una función que entrega lo que ya
venció. El servidor **no** calcula fechas: las repeticiones y la zona horaria viven en el teléfono.

```
teléfono (calcula {cuando, titulo, cuerpo})
      │  POST /rest/v1/rpc/sincronizar_avisos
      ▼
Supabase · tablas dispositivos + avisos  ◀── cron cada minuto ──▶ Edge Function enviar-avisos
      │                                                                    │
      └──────────────────── push (VAPID) ◀──────────────────────────────────┘
```

## Puesta en marcha (una sola vez)

1. **Tablas y cron.** En Supabase → *SQL Editor*, pegá
   `supabase/migrations/0001_etapa10.sql` después de cambiar `<ANON_KEY>` por la anon key del
   proyecto (*Project Settings → API → Project API keys → anon public*). Es la misma clave pública que
   usa la app, así que no hay ningún secreto nuevo en la base. Después, *Run*.
   Al final, esta consulta debe devolver dos filas (`avispate-avisos` y `avispate-limpieza`):

   ```sql
   select jobname, schedule, active from cron.job where jobname like 'avispate-%';
   ```

   Si el editor dice que no existe `net.http_post`, habilitá las extensiones **pg_cron** y **pg_net**
   en *Database → Extensions* y volvé a correr el bloque del cron.

2. **Secretos de la función.** El proyecto ya tiene las claves VAPID en `.env.local` (que no se
   versiona). Se suben a Supabase así:

   ```bash
   npx supabase login
   npx supabase link --project-ref vmctsurhswayrrkggj
   npx supabase secrets set --env-file supabase/.env.functions
   ```

3. **Publicar la función.**

   ```bash
   npx supabase functions deploy enviar-avisos --project-ref vmctsurhswayrrkggj
   ```

   Queda con la verificación de JWT activada (la de por defecto): el cron manda la anon key, que es un
   JWT válido del proyecto y ya es pública.

4. **Probar la función a mano** (debería responder `{"ok":true,"enviados":0,…}`):

   ```bash
   source .env.local
   curl -s -X POST "https://vmctsurhswayrrkggj.supabase.co/functions/v1/enviar-avisos" \
     -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{}'
   ```

5. **La app.** Poné la anon key en `.env.local` (ya está la URL) y compilá:

   ```bash
   npm run build && npm run preview   # https://localhost:8443
   ```

   En Ajustes → *Avisos con la app cerrada* → *Activar avisos* → *Probar aviso*. La prueba llega en
   menos de un minuto, con la app cerrada.

## Cómo está protegido

- Las tablas tienen RLS **sin políticas**: la clave pública que viaja al navegador no puede leer ni
  escribir nada directamente.
- Las cuatro funciones (`registrar_dispositivo`, `olvidar_push`, `sincronizar_avisos`, `probar_aviso`)
  son `security definer` y exigen el **token** del dispositivo (32 bytes al azar, guardados solo en ese
  teléfono). El id del dispositivo solo no alcanza.
- La función de entrega usa la `service_role` (secreta, la pone Supabase sola) y no acepta datos: solo
  lee lo vencido y manda.
- La `VAPID_PRIVATE_KEY` nunca entra al bundle: no lleva el prefijo `VITE_`, así que Vite no la expone.

## Por qué no se pausa el plan gratuito

Supabase pausa los proyectos gratuitos tras una semana sin actividad. El cron corre **cada minuto**,
así que el proyecto está activo mientras exista: es, de paso, la razón por la que el cron es la pieza
central y no un lujo.

## Si algo no llega

| Síntoma | Qué mirar |
| --- | --- |
| La app dice «Falta conectar la nube» | Falta `VITE_SUPABASE_ANON_KEY` en `.env.local`; hay que recompilar. |
| «Faltan las tablas en Supabase» | No se corrió la migración (paso 1) o se corrió en otro proyecto. |
| La prueba no llega y `enviados` es 0 | La suscripción está vacía: en Ajustes, *Apagar* y *Activar avisos* de nuevo. |
| `401` al llamar la función | Se publicó con `--no-verify-jwt` y el cron manda la anon key, o la anon key del SQL es de otro proyecto. |
| `ultimo_error` en `avisos` | Ahí queda el motivo que devolvió el servicio de push (claves VAPID distintas, por ejemplo). |
