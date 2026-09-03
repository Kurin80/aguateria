# App Android de campo

Abrir `apps/android` en Android Studio. Generar Gradle Wrapper si hace falta (`gradle wrapper`).

En `local.properties`:

```
sdk.dir=...
API_BASE_URL=https://tu-dominio/api
```

Permisos: ubicación precisa y cámara. GPS mock se rechaza si el backend/settings lo exigen. Lecturas offline van a Room (`PENDING_SYNC`) y WorkManager las envía con `idempotencyKey`.
