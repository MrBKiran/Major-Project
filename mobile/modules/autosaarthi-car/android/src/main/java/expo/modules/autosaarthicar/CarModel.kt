package expo.modules.autosaarthicar

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * What the app's JavaScript tells the car to show.
 *
 * Every word on the car's screen is chosen in TypeScript (src/car/view.ts), from the same owner
 * wording the phone and the web use, and handed over as one small JSON document per screen. This
 * side draws it and reports what the driver tapped; it decides nothing about what is safe to show.
 * The server decides that from the car's own readings (backend/app/car.py), and the TypeScript
 * leaves out anything the server did not allow — a screen that is told to hold one line while the
 * car moves cannot be made to hold two by anything in here.
 */
enum class CarKind { PANE, LIST, MESSAGE }

/** A button. `parkedOnly` makes the car's own host refuse the tap while the car is moving as well. */
data class CarAction(
    val id: String,
    val title: String,
    val primary: Boolean = false,
    val parkedOnly: Boolean = false,
)

/** One line of the screen: a title and up to two lines under it. In a list it can be tapped. */
data class CarRow(
    val title: String,
    val text: List<String> = emptyList(),
    val action: String? = null,
    val parkedOnly: Boolean = false,
)

data class CarScreenModel(
    val id: String,
    val kind: CarKind,
    val title: String,
    val message: String = "",
    val rows: List<CarRow> = emptyList(),
    val actions: List<CarAction> = emptyList(),
    val loading: Boolean = false,
    val empty: String = "",
    val back: Boolean = false,
)

/** The JavaScript sent something this side cannot draw. The message says what. */
class InvalidModelException(message: String) : IllegalArgumentException(message)

object CarModel {
    /** The car's templates take at most two buttons and two lines of text under a title. */
    const val MAX_ACTIONS = 2
    const val MAX_TEXT_LINES = 2
    private const val MAX_ID = 64

    fun parse(json: String): CarScreenModel {
        val root = try {
            JSONObject(json)
        } catch (e: JSONException) {
            throw InvalidModelException("the screen is not valid JSON: ${e.message}")
        }

        val id = root.optString("id").trim()
        if (id.isEmpty() || id.length > MAX_ID) throw InvalidModelException("a screen needs an id of 1 to $MAX_ID characters")

        val kind = when (root.optString("kind")) {
            "pane" -> CarKind.PANE
            "list" -> CarKind.LIST
            "message" -> CarKind.MESSAGE
            else -> throw InvalidModelException("screen '$id' has an unknown kind '${root.optString("kind")}'")
        }

        val title = root.optString("title").trim()
        if (title.isEmpty()) throw InvalidModelException("screen '$id' needs a title")

        val message = root.optString("message").trim()
        if (kind == CarKind.MESSAGE && message.isEmpty()) throw InvalidModelException("message screen '$id' needs a message")

        return CarScreenModel(
            id = id,
            kind = kind,
            title = title,
            message = message,
            rows = rows(id, root.optJSONArray("rows")),
            actions = actions(id, root.optJSONArray("actions")),
            loading = root.optBoolean("loading", false),
            empty = root.optString("empty").trim(),
            back = root.optBoolean("back", false),
        )
    }

    private fun rows(screen: String, array: JSONArray?): List<CarRow> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { i ->
            val row = array.optJSONObject(i) ?: throw InvalidModelException("screen '$screen' row $i is not an object")
            val title = row.optString("title").trim()
            if (title.isEmpty()) throw InvalidModelException("screen '$screen' row $i needs a title")
            val lines = row.optJSONArray("text")
            val text = if (lines == null) emptyList() else (0 until lines.length())
                .map { lines.optString(it).trim() }
                .filter { it.isNotEmpty() }
                .take(MAX_TEXT_LINES)
            CarRow(
                title = title,
                text = text,
                action = row.optString("action").trim().ifEmpty { null },
                parkedOnly = row.optBoolean("parkedOnly", false),
            )
        }
    }

    private fun actions(screen: String, array: JSONArray?): List<CarAction> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { i ->
            val action = array.optJSONObject(i) ?: throw InvalidModelException("screen '$screen' action $i is not an object")
            val id = action.optString("id").trim()
            val title = action.optString("title").trim()
            if (id.isEmpty() || title.isEmpty()) throw InvalidModelException("screen '$screen' action $i needs an id and a title")
            CarAction(id, title, action.optBoolean("primary", false), action.optBoolean("parkedOnly", false))
        }.take(MAX_ACTIONS)
    }
}
