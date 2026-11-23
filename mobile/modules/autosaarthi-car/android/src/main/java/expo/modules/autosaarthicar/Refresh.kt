package expo.modules.autosaarthicar

/**
 * Which changes the car's host treats as a *refresh*, and which as a new template.
 *
 * The host lets an app show at most five templates in a task, and closes the app, with an error on
 * the car's screen, when a sixth is sent (the Screen class's `onGetTemplate` documentation). A
 * refresh does not count, so a screen that changes with the car's state — parked, moving, a new
 * reading — has to change in ways the host calls refreshes, and anything else has to start a new
 * screen instead, whose count starts again (see CarBridge.replaceTop).
 *
 * The rules, from the documentation of each template:
 *   - Pane and List: a refresh if the previous template was loading, or if the title and the number
 *     of rows and each row's title are unchanged. The lines of text under a title may change.
 *   - Message: a refresh if the title and the message are unchanged.
 *   - Any change of kind (a card where a message was) is a new template.
 *
 * This is deliberately a little stricter than that — a different header (back arrow or app icon)
 * is not called a refresh — because wrongly calling something a refresh is the expensive mistake:
 * an unnecessary new screen costs a slide, a miscounted template costs the app.
 */
object Refresh {

    fun isRefresh(previous: CarScreenModel?, next: CarScreenModel): Boolean {
        // Nothing has been drawn yet, so there is nothing to refresh and nothing to count.
        if (previous == null) return true
        if (previous.kind != next.kind || previous.back != next.back) return false
        return when (next.kind) {
            CarKind.MESSAGE -> previous.title == next.title && previous.message == next.message
            CarKind.PANE, CarKind.LIST -> previous.loading || (previous.title == next.title && sameRows(previous, next))
        }
    }

    private fun sameRows(a: CarScreenModel, b: CarScreenModel): Boolean =
        a.rows.size == b.rows.size && a.rows.indices.all { a.rows[it].title == b.rows[it].title }
}
