package com.fakedisco.terminalbrowser

import android.os.Bundle
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.NestedScrollView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var terminalOutput: TextView
    private lateinit var terminalInput: EditText
    private lateinit var runButton: Button
    private lateinit var webView: WebView
    private lateinit var terminalScroll: NestedScrollView

    private lateinit var assetLoader: WebViewAssetLoader

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        terminalOutput = findViewById(R.id.terminalOutput)
        terminalInput = findViewById(R.id.terminalInput)
        runButton = findViewById(R.id.runButton)
        webView = findViewById(R.id.webView)
        terminalScroll = findViewById(R.id.terminalScroll)

        setupWebView()
        printBootMessage()

        runButton.setOnClickListener {
            val command = terminalInput.text.toString()
            if (command.isNotBlank()) {
                appendLine("$ $command")
                executeCommand(command)
                terminalInput.text.clear()
            }
        }
    }

    private fun setupWebView() {
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.javaScriptEnabled = true
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: android.webkit.WebResourceRequest
            ): android.webkit.WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }
        }

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    private fun printBootMessage() {
        appendLine("Terminal Browser ready.")
        appendLine("Type 'help' for commands.")
        appendLine("Use 'run index.html' (or 'rum index.html') to open a page from assets/www.")
    }

    private fun executeCommand(raw: String) {
        val parts = raw.trim().split("\\s+".toRegex())
        val command = parts.firstOrNull()?.lowercase(Locale.US) ?: return

        when (command) {
            "help" -> {
                appendLine("Commands:")
                appendLine("- help")
                appendLine("- clear")
                appendLine("- ls")
                appendLine("- cat <file>")
                appendLine("- run <file>")
                appendLine("- rum <file> (alias of run)")
            }

            "clear" -> terminalOutput.text = ""

            "ls" -> {
                val files = assets.list("www")?.sorted().orEmpty()
                if (files.isEmpty()) appendLine("www/ is empty")
                files.forEach { appendLine(it) }
            }

            "cat" -> {
                if (parts.size < 2) {
                    appendLine("Usage: cat <file>")
                    return
                }
                val file = parts[1]
                val text = readAssetText(file)
                if (text == null) {
                    appendLine("File not found: $file")
                } else {
                    appendLine(text)
                }
            }

            "run", "rum" -> {
                if (parts.size < 2) {
                    appendLine("Usage: run <file>")
                    return
                }
                val file = parts[1]
                if (assetExists(file)) {
                    val url = "https://appassets.androidplatform.net/assets/www/$file"
                    webView.loadUrl(url)
                    appendLine("Loaded $file in browser pane.")
                } else {
                    appendLine("File not found: $file")
                }
            }

            else -> appendLine("Unknown command: $command")
        }
    }

    private fun readAssetText(file: String): String? {
        return try {
            assets.open("www/$file").use { input ->
                BufferedReader(InputStreamReader(input)).readText()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun assetExists(file: String): Boolean {
        return try {
            assets.open("www/$file").close()
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun appendLine(line: String) {
        terminalOutput.append(line)
        terminalOutput.append("\n")
        terminalScroll.post {
            terminalScroll.fullScroll(NestedScrollView.FOCUS_DOWN)
        }
    }
}
