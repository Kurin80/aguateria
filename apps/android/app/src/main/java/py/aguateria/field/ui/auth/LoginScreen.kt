package py.aguateria.field.ui.auth

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable

@Composable
fun LoginScreen(vm: SessionViewModel) {
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    val error by vm.error.collectAsStateWithLifecycle()
    Column(Modifier.padding(24.dp)) {
        Text("Aguatería — campo")
        OutlinedTextField(user, { user = it }, label = { Text("Usuario o email") })
        OutlinedTextField(pass, { pass = it }, label = { Text("Contraseña") }, visualTransformation = PasswordVisualTransformation())
        error?.let { Text(it) }
        Button(onClick = { vm.login(user, pass) }) { Text("Ingresar") }
    }
}
