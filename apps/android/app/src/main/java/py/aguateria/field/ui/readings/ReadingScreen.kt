package py.aguateria.field.ui.readings

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import py.aguateria.field.core.location.DeviceLocationClient
import py.aguateria.field.data.api.AguateriaApi
import py.aguateria.field.data.local.PendingOperationDao
import py.aguateria.field.data.local.PendingOperationEntity
import py.aguateria.field.data.sync.SyncScheduler
import py.aguateria.field.ui.camera.CameraCapture
import py.aguateria.field.ui.qr.QrScanScreen
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class ReadingViewModel @Inject constructor(
    app: Application,
    private val location: DeviceLocationClient,
    private val dao: PendingOperationDao,
    private val api: AguateriaApi,
    private val json: Json,
) : AndroidViewModel(app) {
    var message by mutableStateOf<String?>(null)
        private set
    var connectionId by mutableStateOf("")
    var meterId by mutableStateOf("")
    var previousReading by mutableStateOf<String?>(null)
    var customerName by mutableStateOf<String?>(null)
    var photoUri by mutableStateOf<String?>(null)

    fun applyQr(token: String) {
        viewModelScope.launch {
            try {
                val data = api.byQr(token).data
                connectionId = data["connection"]?.jsonObject?.get("id")?.jsonPrimitive?.content.orEmpty()
                meterId = data["meter"]?.jsonObject?.get("id")?.jsonPrimitive?.content.orEmpty()
                message = "Conexión identificada por QR"
            } catch (ex: Exception) {
                message = ex.message ?: "QR no encontrado"
            }
        }
    }

    fun save(current: String) {
        viewModelScope.launch {
            if (photoUri.isNullOrBlank()) {
                message = "Tomá la fotografía del medidor antes de guardar."
                return@launch
            }
            val gps = try {
                location.currentFix()
            } catch (ex: Exception) {
                message = "No se obtuvo GPS. Concedé permiso de ubicación."
                return@launch
            }
            if (gps.mocked) {
                message = "Ubicación simulada rechazada"
                return@launch
            }
            if (gps.accuracyMeters > 30f) {
                message = "Precisión GPS insuficiente (${gps.accuracyMeters} m). Se guardará con incidencia."
            }
            val prev = previousReading?.toDoubleOrNull()
            val curr = current.toDoubleOrNull()
            if (prev != null && curr != null && curr < prev) {
                message = "La lectura actual es menor que la anterior. Confirmá incidencia en observaciones al sincronizar."
            }
            val key = UUID.randomUUID().toString()
            val payload = buildJsonObject {
                put("idempotencyKey", key)
                put("connectionId", connectionId)
                put("meterId", meterId)
                put("currentReading", current)
                put("deviceCapturedAt", Instant.ofEpochMilli(gps.capturedAtMillis).toString())
                put("gps", buildJsonObject {
                    put("latitude", gps.latitude)
                    put("longitude", gps.longitude)
                    put("accuracyMeters", gps.accuracyMeters.toDouble())
                    put("mocked", gps.mocked)
                })
            }
            dao.insert(
                PendingOperationEntity(
                    idempotencyKey = key,
                    type = "reading",
                    payloadJson = json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), payload),
                    status = "PENDING_SYNC",
                    photoLocalUri = photoUri,
                    lastError = null,
                    createdAt = System.currentTimeMillis(),
                    baseVersion = null,
                ),
            )
            SyncScheduler.enqueue(getApplication())
            message = "Lectura en cola. GPS ±${gps.accuracyMeters.toInt()} m. Sincroniza al tener red. Podés pasar al siguiente medidor."
        }
    }
}

@Composable
fun ReadingScreen(
    initialConnection: String = "",
    initialMeter: String = "",
    initialPrevious: String = "",
    initialCustomer: String = "",
    vm: ReadingViewModel = hiltViewModel(),
) {
    val ctx = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    LaunchedEffect(Unit) {
        val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
        if (fine != PackageManager.PERMISSION_GRANTED) {
            permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }
    var value by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf("form") }
    if (initialConnection.isNotBlank() && vm.connectionId.isBlank()) vm.connectionId = initialConnection
    if (initialMeter.isNotBlank() && vm.meterId.isBlank()) vm.meterId = initialMeter
    if (initialPrevious.isNotBlank() && vm.previousReading == null) vm.previousReading = initialPrevious
    if (initialCustomer.isNotBlank() && vm.customerName == null) vm.customerName = initialCustomer
    when (mode) {
        "camera" -> CameraCapture(
            onCaptured = {
                vm.photoUri = it.toString()
                vm.message = "Fotografía del medidor ✓"
                mode = "form"
            },
            onCancel = { mode = "form" },
        )
        "qr" -> QrScanScreen(
            onFound = {
                vm.applyQr(it)
                mode = "form"
            },
            onCancel = { mode = "form" },
        )
        else -> Column(Modifier.padding(16.dp)) {
            Text("Lectura de medidor")
            vm.customerName?.let { Text(it) }
            vm.previousReading?.let { Text("Lectura anterior: $it") }
            OutlinedTextField(vm.connectionId, { vm.connectionId = it }, label = { Text("ID conexión") })
            OutlinedTextField(vm.meterId, { vm.meterId = it }, label = { Text("ID medidor") })
            OutlinedTextField(
                value,
                { value = it },
                label = { Text("Lectura actual") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            Button(onClick = { mode = "qr" }) { Text("Escanear QR") }
            Button(onClick = { mode = "camera" }) { Text("Tomar foto") }
            Button(onClick = { vm.save(value) }) { Text("Guardar (GPS nativo + cola offline)") }
            vm.photoUri?.let { Text("Fotografía del medidor ✓") }
            vm.message?.let { Text(it) }
        }
    }
}
