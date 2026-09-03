package py.aguateria.field.ui.routes

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import py.aguateria.field.data.api.AguateriaApi
import py.aguateria.field.data.api.StartFieldRequest
import javax.inject.Inject

private fun JsonElement?.text(): String {
    if (this == null || this is JsonNull) return ""
    return runCatching { jsonPrimitive.content }.getOrDefault("")
}

@HiltViewModel
class RoutesViewModel @Inject constructor(private val api: AguateriaApi) : ViewModel() {
    var items by mutableStateOf<List<Map<String, JsonElement>>>(emptyList())
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var starting by mutableStateOf(false)
        private set

    fun load(query: String = "") {
        viewModelScope.launch {
            try {
                items = api.fieldQueue(status = "pending", q = query.ifBlank { null }).data
                error = null
            } catch (ex: Exception) {
                error = ex.message
            }
        }
    }

    fun startReading(
        connectionId: String,
        meterId: String,
        previous: String,
        customer: String,
        onStarted: (connectionId: String, meterId: String, previous: String, customer: String) -> Unit,
    ) {
        viewModelScope.launch {
            starting = true
            try {
                api.startField(StartFieldRequest(connectionId))
                error = null
                onStarted(connectionId, meterId, previous, customer)
            } catch (ex: Exception) {
                error = ex.message ?: "No se pudo iniciar la lectura"
            } finally {
                starting = false
            }
        }
    }
}

@Composable
fun RoutesScreen(
    onOpenStop: (connectionId: String, meterId: String, previous: String, customer: String) -> Unit,
    vm: RoutesViewModel = hiltViewModel(),
) {
    LaunchedEffect(Unit) { vm.load() }
    var query by remember { mutableStateOf("") }
    Column(Modifier.padding(16.dp)) {
        Text("Lectura de campo")
        OutlinedTextField(
            query,
            {
                query = it
                vm.load(it)
            },
            label = { Text("Buscar cliente, medidor, CI o dirección") },
            modifier = Modifier.fillMaxWidth(),
        )
        vm.error?.let { Text(it) }
        LazyColumn {
            items(vm.items) { item ->
                val connectionId = item["connectionId"].text()
                val meterId = item["meterId"].text()
                val previous = item["previousReading"].text().ifBlank { item["initialReading"].text() }
                val customer = item["customerName"].text()
                Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(customer.ifBlank { item["connectionCode"].text() })
                        Text(item["address"].text())
                        Text("Medidor: ${item["meterNumber"].text().ifBlank { "—" }}")
                        if (previous.isNotBlank()) Text("Lectura anterior: $previous")
                        Button(
                            onClick = {
                                if (connectionId.isNotBlank()) {
                                    vm.startReading(connectionId, meterId, previous, customer, onOpenStop)
                                }
                            },
                            enabled = !vm.starting && connectionId.isNotBlank() && meterId.isNotBlank(),
                        ) { Text(if (vm.starting) "Iniciando…" else "Iniciar lectura") }
                    }
                }
            }
        }
    }
}
