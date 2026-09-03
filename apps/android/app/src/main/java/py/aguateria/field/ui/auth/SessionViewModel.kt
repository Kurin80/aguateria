package py.aguateria.field.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import py.aguateria.field.data.api.AguateriaApi
import py.aguateria.field.data.api.LoginRequest
import py.aguateria.field.data.session.SessionStore
import javax.inject.Inject

@HiltViewModel
class SessionViewModel @Inject constructor(
    private val api: AguateriaApi,
    private val session: SessionStore,
) : ViewModel() {
    private val _loggedIn = MutableStateFlow(session.accessToken != null)
    val loggedIn = _loggedIn.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    fun login(identifier: String, password: String) {
        viewModelScope.launch {
            try {
                val res = api.login(LoginRequest(identifier, password))
                session.accessToken = res.data.accessToken
                session.refreshToken = res.data.refreshToken
                _loggedIn.value = true
                _error.value = null
            } catch (ex: Exception) {
                _error.value = ex.message
            }
        }
    }

    fun logout() {
        session.clear()
        _loggedIn.value = false
    }
}
