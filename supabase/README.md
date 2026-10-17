# Nube de AVISPATE · Etapas 10 y 11 (avisos con la app cerrada)

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
   `supabase/migrations/0001_etapa10.sql` con `<ANON_KEY>` cambiada por la anon key del proyecto
   (*Project Settings → API keys → anon public*). Es la misma clave pública que usa la app, así que no
   hay ningún secreto nuevo en la base. Después, *Run*. El archivo del repo conserva el marcador a
   propósito: si lo corrés tal cual, el editor avisa *«Falta la anon key en v_anon»* y el cron queda
   sin autorización.
   Al final, esta consulta debe devolver dos filas (`avispate-avisos` y `avispate-limpieza`):

   ```sql
   select jobname, schedule, active from cron.job where jobname like 'avispate-%';
   ```

   Si el editor dice que no existe `net.http_post`, habilitá las extensiones **pg_cron** y **pg_net**
   en *Database → Extensions* y volvé a correr el bloque del cron.

   **Etapa 11.** Después de la 0001, corré también `supabase/migrations/0002_etapa11.sql` (esa no lleva
   ningún marcador que cambiar). Agrega `pospuesto_en` —la marca que evita que la sincronización borre un
   aviso pospuesto—, las funciones `posponer_aviso` y `resumen_cola`, y vuelve a crear
   `sincronizar_avisos` para respetar esa marca. Es idempotente. Al final, esto debe devolver dos filas:

   ```sql
   select proname from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('posponer_aviso', 'resumen_cola');
   ```

2. **Secretos de la función.** El proyecto ya tiene las claves VAPID en `.env.local` (que no se
   versiona). Se suben a Supabase así:

   ```bash
   npx --yes supabase@latest login
   npx --yes supabase@latest link --project-ref vmctsurhswayrrwrkggj
   npx --yes supabase@latest secrets set --env-file supabase/.env.functions
   ```

   El `--yes` evita que `npx` se quede esperando un «Ok to proceed?» que nadie ve.

3. **Publicar la función.**

   ```bash
   npx --yes supabase@latest functions deploy enviar-avisos --project-ref vmctsurhswayrrwrkggj
   ```

   Queda con la verificación de JWT activada (la de por defecto): el cron manda la anon key, que es un
   JWT válido del proyecto y ya es pública.

   Desde la Etapa 11 el payload lleva también el id del aviso (es lo que permite posponer desde la
   notificación): si venís de la Etapa 10, **volvé a publicar la función** con este mismo comando.

4. **Probar la función a mano** (debería responder `{"ok":true,"enviados":0,…}`):

   ```bash
   source .env.local
   curl -s -X POST "https://vmctsurhswayrrwrkggj.supabase.co/functions/v1/enviar-avisos" \
     -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{}'
   ```

5. **La app.** `.env.local` ya tiene la URL, la anon key y la VAPID pública. Compilá y abrí el preview:

   ```bash
   npm run build && npm run preview   # https://localhost:8443
   ```

   En Ajustes → *Avisos con la app cerrada* → *Activar avisos* → *Probar aviso*. La prueba llega en
   menos de un minuto, con la app cerrada.

## Cómo está protegido

- Las tablas tienen RLS **sin políticas**: la clave pública que viaja al navegador no puede leer ni
  escribir nada directamente.
- Las cuatro funciones de la Etapa 10 (`registrar_dispositivo`, `olvidar_push`, `sincronizar_avisos`,
  `probar_aviso`) y las dos de la Etapa 11 (`posponer_aviso`, `resumen_cola`) son `security definer` y
  exigen el **token** del dispositivo (32 bytes al azar, guardados solo en ese teléfono). El id del
  dispositivo solo no alcanza.
- La función de entrega usa la `service_role` (secreta, la pone Supabase sola) y no acepta datos: solo
  lee lo vencido y manda.
- La `VAPID_PRIVATE_KEY` nunca entra al bundle: no lleva el prefijo `VITE_`, así que Vite no la expone.

## Posponer desde la notificación (Etapa 11)

La notificación ofrece «Posponer 10 min» y «Posponer 1 hora». Al tocarlas no se abre la app: el service
worker llama a `posponer_aviso` con el id del aviso y el token del dispositivo, y la fila vuelve a quedar
pendiente a la hora nueva (`cuando = now() + N minutos`, `enviado_en = null`). La próxima pasada del cron
la entrega.

Para que eso funcione con la app cerrada, el worker necesita dos cosas: la URL y la anon key de Supabase
—se las inyecta el build en `sw.js`, son las mismas que ya viajan en el bundle— y el par id/token del
dispositivo, que la app le manda por mensaje la primera vez y él guarda en IndexedDB (el localStorage de
la página no existe del lado del worker). Si falta cualquiera de las dos, el toque abre la app.

Los avisos pospuestos llevan `pospuesto_en` para que `sincronizar_avisos` no los borre: la cola que sube
el teléfono no los incluye, y sin esa marca se perderían en la próxima sincronización.

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
| `403` al entregar el push | Las dos claves VAPID públicas tienen que ser la misma: el teléfono se suscribe con `VITE_VAPID_PUBLIC_KEY` y el servidor firma con `VAPID_PUBLIC_KEY`. Se generan juntas, con `node scripts/generar-vapid.mjs`. |
| `ultimo_error` en `avisos` | Ahí queda el motivo que devolvió el servicio de push (claves VAPID distintas, por ejemplo). |
| «Posponer» abre la app en vez de posponer | Falta correr la `0002_etapa11.sql`, o el teléfono no tiene guardadas sus credenciales: *Apagar* y *Activar avisos* de nuevo. |
| La notificación no muestra los botones | El teléfono o el navegador no permiten acciones en las notificaciones (iOS viejo, por ejemplo): tocarla abre la app, que es el camino de siempre. |
