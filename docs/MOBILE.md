# Aplicación Android

Usuarios: lectores, técnicos, supervisores. Habla **exclusivamente** con la API HTTPS. Sin Supabase client, sin SQL, sin service role.

## 1. Stack

- Kotlin, minSdk 26, targetSdk 35
- Jetpack Compose + Material 3
- MVVM + Clean Architecture (`app` / `domain` / `data`)
- Hilt, Retrofit + OkHttp, Kotlinx Serialization
- Room (cola offline), DataStore (sesión)
- WorkManager (sync)
- CameraX (foto nativa, no galería simulada como fuente de lectura)
- Play Services Location / `LocationManager` GPS del dispositivo
- ML Kit Barcode / CameraX ML para QR
- Biometría / PIN / MFA: interfaces listas, no activas por defecto

## 2. Módulos de UI

Login · Lectura de campo (cola de conexiones) · Lectura de medidor · Escaneo QR.

## 3. Autenticación

1. `POST /auth/login` → access + refresh.
2. Access en memoria / DataStore cifrado (EncryptedSharedPreferences / Encrypted DataStore).
3. Interceptor: 401 → refresh rotativo; fallo → logout.
4. Logout revoca refresh en servidor.
5. Preparado: `BiometricPrompt`, PIN local, MFA (TOTP) vía API futura.

## 4. Lectura de medidor

Flujo:

1. Abrir un suministro de la cola **o** escanear QR de conexión/medidor.
2. API/cache muestra cliente, conexión, medidor, dirección, última lectura.
3. Operario ingresa lectura actual.
4. Captura GPS nativo (no mock). Si `accuracy > settings.gpsMaxAccuracyMeters` (default 30) → advertencia; si la empresa exige GPS estricto, bloquea el guardado.
5. Foto con CameraX; se guarda local y se sube a Storage **vía API** (`upload-url`). En web de campo: `GET /campo` con cámara del navegador.
6. Consumo mostrado es **preliminar** (actual − anterior). El consumo oficial y la facturación los calcula el backend. Si hay anomalía, el backend marca `requires_review` y no factura en automático.
7. El backend calcula distancia al suministro (geovalla). Fuera de rango: `GPS_OUT_OF_RANGE`.
8. Offline: solo Android (Room). La PWA web no encola lecturas.

Campos persistidos localmente: cliente, medidor, fechas dispositivo, GPS, foto, `idempotency_key` (UUID v4 generado al crear la operación).

## 5. Offline

Room:

- `PendingOperation(entityType, payloadJson, idempotencyKey, status, photoLocalUri, createdAt, lastError)`
- Estados: `LOCAL` → `PENDING_SYNC` → `SYNCING` → `SYNCED` | `ERROR` | `CONFLICT`

WorkManager: al recuperar red, `SyncWorker` envía `POST /sync/push`. Duplicados evitados por `idempotency_key`.

Fotos: se suben primero; el push de lectura lleva el `fileId` ya confirmado. Si falla el upload, la operación permanece `ERROR` reintentable.

## 6. Conflictos

Si el servidor responde `CONFLICT`, la fila pasa a `CONFLICT` y **no** se sobrescribe. El supervisor resuelve en web o en una pantalla de conflictos (v1: listado + “ver servidor vs local”; resolución en API).

## 7. Push

`PushTokenRepository` registra el token en `POST /devices/push-token`. Integración FCM: dependencia y canal de notificación listos; requiere `google-services.json` del proyecto Firebase del prestador. Sin ese archivo la app funciona igual, sin push.

## 8. Seguridad en dispositivo

- Certificate pinning opcional (hashes en BuildConfig / Remote Config interno, no hardcode de secretos).
- No logs de tokens ni fotos en Logcat de release.
- Root/mock location: detectar `isFromMockProvider` y rechazar lectura si `settings.rejectMockLocation=true`.

## 9. Reloj

La UI muestra hora local. El backend usa su reloj para operaciones críticas. Se envían `deviceCapturedAt` y `timeZone` solo como evidencia.

## 10. Estructura Gradle

```
apps/android/
  app/
    src/main/java/py/aguateria/field/
      ui/          Compose screens + ViewModels
      domain/      use cases, modelos
      data/        api, room, sync
      core/        session, location, camera, qr
```
