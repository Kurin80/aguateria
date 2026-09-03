package py.aguateria.field.ui

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dagger.hilt.android.AndroidEntryPoint
import py.aguateria.field.ui.auth.LoginScreen
import py.aguateria.field.ui.auth.SessionViewModel
import py.aguateria.field.ui.readings.ReadingScreen
import py.aguateria.field.ui.routes.RoutesScreen

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val session: SessionViewModel = hiltViewModel()
            val loggedIn by session.loggedIn.collectAsStateWithLifecycle()
            if (!loggedIn) {
                LoginScreen(session)
            } else {
                val nav = rememberNavController()
                val back by nav.currentBackStackEntryAsState()
                val current = back?.destination?.route ?: "queue"
                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            listOf("queue" to "Cola", "reading" to "Lectura").forEach { (route, label) ->
                                NavigationBarItem(
                                    selected = current.startsWith(route),
                                    onClick = { nav.navigate(route) },
                                    icon = {},
                                    label = { Text(label) },
                                )
                            }
                        }
                    },
                ) { padding ->
                    NavHost(nav, startDestination = "queue", modifier = Modifier.padding(padding)) {
                        composable("queue") {
                            RoutesScreen(onOpenStop = { connectionId, meterId, previous, customer ->
                                val m = meterId.ifBlank { "_" }
                                nav.navigate(
                                    "reading/${Uri.encode(connectionId)}/${Uri.encode(m)}" +
                                        "?prev=${Uri.encode(previous)}&name=${Uri.encode(customer)}",
                                )
                            })
                        }
                        composable("reading") { ReadingScreen() }
                        composable(
                            "reading/{connectionId}/{meterId}?prev={prev}&name={name}",
                            arguments = listOf(
                                navArgument("connectionId") { type = NavType.StringType },
                                navArgument("meterId") { type = NavType.StringType },
                                navArgument("prev") { type = NavType.StringType; defaultValue = "" },
                                navArgument("name") { type = NavType.StringType; defaultValue = "" },
                            ),
                        ) { entry ->
                            val conn = entry.arguments?.getString("connectionId").orEmpty()
                            val meter = entry.arguments?.getString("meterId").orEmpty().let { if (it == "_") "" else it }
                            val prev = entry.arguments?.getString("prev").orEmpty()
                            val name = entry.arguments?.getString("name").orEmpty()
                            ReadingScreen(
                                initialConnection = conn,
                                initialMeter = meter,
                                initialPrevious = prev,
                                initialCustomer = name,
                            )
                        }
                    }
                }
            }
        }
    }
}
