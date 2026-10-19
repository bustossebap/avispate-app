# Etapa 16 · Calendarios reales (Google, Apple y Outlook)

Estado: **bloqueada por credenciales externas**. La Etapa 15 dejó la cuenta, el motor de
sincronización y los adjuntos listos. Para que un cambio hecho en AVISPATE aparezca solo en el
calendario —y al revés— hacen falta permisos OAuth de cada proveedor; no se puede resolver solo con
código local ni con la anon key de Supabase.

## Qué falta

| Proveedor | Credencial / permiso | Qué permite |
| --- | --- | --- |
| Google Calendar | Proyecto de Google Cloud, OAuth consent screen, client id/secret y redirect URI de la app; scope `https://www.googleapis.com/auth/calendar.events` | Crear, editar y borrar eventos; leer cambios para traerlos a AVISPATE. |
| Apple Calendar | Apple Developer Program, un service id de Calendar y un backend que haga CalDAV/oAuth; en iOS se puede usar EventKit con permiso del usuario | Sincronización real con iCloud/CalDAV. En la web pura no hay una API equivalente. |
| Outlook / Microsoft 365 | Registro de app en Microsoft Entra ID, redirect URI y scope `Calendars.ReadWrite` (Microsoft Graph) | Crear y leer eventos del calendario de la cuenta. |

También hace falta decidir dónde vive el token de cada proveedor. La opción segura es una Edge
Function con `service_role` y secretos de Supabase; el navegador nunca recibe el refresh token. La
app ya tiene el patrón de funciones autenticadas y RLS de la Etapa 15 para colgarlo de `auth.uid()`.

## Lo que sí se puede hacer sin credenciales

- Mantener el `.ics` y los enlaces de Google/Outlook como están hoy (agregar un evento a mano).
- Unificar los tres estados de calendario por usuario en una tabla `calendarios_cuenta` cuando exista
  OAuth, sin tocar los recordatorios.
- Probar el flujo con un proveedor de mentira en la batería, como se hizo con Realtime.

## Orden sugerido cuando lleguen las credenciales

1. Google (es el que ya tiene el flujo de "Agregar a Google Calendar" y el más fácil de probar).
2. Outlook (Microsoft Graph, mismo patrón OAuth).
3. Apple (CalDAV/EventKit; probablemente requiera una app nativa o un backend CalDAV).
4. Realtime de calendarios: usar el mismo canal de la Etapa 15 o webhooks del proveedor para avisar
   al teléfono.

Hasta entonces, la Etapa 16 queda fuera del alcance de una entrega solo de código.
