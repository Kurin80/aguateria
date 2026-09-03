package py.aguateria.field.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query

interface AguateriaApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): Envelope<LoginResponse>

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): Envelope<LoginResponse>

    @GET("auth/me")
    suspend fun me(): Envelope<MeResponse>

    @GET("field/queue")
    suspend fun fieldQueue(
        @Query("status") status: String = "pending",
        @Query("q") q: String? = null,
    ): Envelope<List<Map<String, kotlinx.serialization.json.JsonElement>>>

    @POST("field/start")
    suspend fun startField(@Body body: StartFieldRequest): Envelope<Map<String, kotlinx.serialization.json.JsonElement>>

    @POST("files/upload-url")
    suspend fun uploadUrl(@Body body: UploadUrlRequest): Envelope<UploadUrlResponse>

    @POST("readings")
    suspend fun createReading(
        @Header("X-Idempotency-Key") key: String,
        @Body body: Map<String, kotlinx.serialization.json.JsonElement>,
    ): Envelope<Map<String, kotlinx.serialization.json.JsonElement>>

    @GET("connections/by-qr/{token}")
    suspend fun byQr(@retrofit2.http.Path("token") token: String): Envelope<Map<String, kotlinx.serialization.json.JsonElement>>
}

@Serializable data class Envelope<T>(val data: T)
@Serializable data class LoginRequest(val identifier: String, val password: String, val deviceId: String? = null)
@Serializable data class RefreshRequest(val refreshToken: String)
@Serializable data class LoginResponse(val accessToken: String, val refreshToken: String, val expiresIn: Int)
@Serializable data class MeResponse(val id: String, val email: String, val fullName: String, val permissions: List<String>)
@Serializable data class UploadUrlRequest(val purpose: String, val contentType: String, val fileName: String)
@Serializable data class UploadUrlResponse(val fileId: String, val uploadUrl: String, val path: String, val bucket: String)
@Serializable data class StartFieldRequest(val connectionId: String)
