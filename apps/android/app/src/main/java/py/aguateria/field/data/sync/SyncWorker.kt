package py.aguateria.field.data.sync

import android.content.Context
import android.net.Uri
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import py.aguateria.field.data.api.AguateriaApi
import py.aguateria.field.data.api.UploadUrlRequest
import py.aguateria.field.data.local.PendingOperationDao
import java.io.File

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted ctx: Context,
    @Assisted params: WorkerParameters,
    private val dao: PendingOperationDao,
    private val api: AguateriaApi,
    private val json: Json,
) : CoroutineWorker(ctx, params) {
    private val storageHttp = OkHttpClient()

    override suspend fun doWork(): Result {
        val pending = dao.dueForSync()
        for (op in pending) {
            dao.updateStatus(op.idempotencyKey, "SYNCING", null)
            try {
                when (op.type) {
                    "reading" -> {
                        var payload = json.parseToJsonElement(op.payloadJson).jsonObject
                        val photo = op.photoLocalUri
                        if (!photo.isNullOrBlank()) {
                            val file = File(Uri.parse(photo).path ?: photo.removePrefix("file://"))
                            if (file.exists()) {
                                val signed = api.uploadUrl(UploadUrlRequest("meter-photo", "image/jpeg", file.name))
                                val put = Request.Builder()
                                    .url(signed.data.uploadUrl)
                                    .put(file.asRequestBody("image/jpeg".toMediaType()))
                                    .build()
                                storageHttp.newCall(put).execute().use { res ->
                                    if (!res.isSuccessful) throw IllegalStateException("Fallo al subir foto (${res.code})")
                                }
                                payload = JsonObject(payload + ("photoFileId" to JsonPrimitive(signed.data.fileId)))
                            }
                        }
                        api.createReading(op.idempotencyKey, payload)
                    }
                }
                dao.updateStatus(op.idempotencyKey, "SYNCED", null)
            } catch (ex: Exception) {
                val conflict = ex.message?.contains("CONFLICT") == true
                dao.updateStatus(op.idempotencyKey, if (conflict) "CONFLICT" else "ERROR", ex.message)
            }
        }
        return Result.success()
    }
}
