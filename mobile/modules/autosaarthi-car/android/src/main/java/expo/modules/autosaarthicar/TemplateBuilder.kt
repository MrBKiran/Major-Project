package expo.modules.autosaarthicar

import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.OnClickListener
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.ParkedOnlyOnClickListener
import androidx.car.app.model.Row
import androidx.car.app.model.Template

/** How much the car's host will show: it ignores rows beyond these, and they differ by car. */
data class Limits(val list: Int = 6, val pane: Int = 4)

/**
 * Turns a [CarScreenModel] into the Car App Library's templates — the only part that knows what a
 * Pane, a List or a Message is.
 *
 * `setTitle` and `setHeaderAction` are deprecated in 1.7.0 in favour of a `Header` (car API level 7),
 * but they work on every host that supports the IOT category (level 6), which is what the app
 * declares as its minimum, so they are used on purpose.
 */
@Suppress("DEPRECATION")
object TemplateBuilder {

    fun build(model: CarScreenModel, limits: Limits, onAction: (screen: String, action: String) -> Unit): Template =
        when (model.kind) {
            CarKind.PANE -> pane(model, limits, onAction)
            CarKind.LIST -> list(model, limits, onAction)
            CarKind.MESSAGE -> message(model, onAction)
        }

    private fun header(model: CarScreenModel): Action = if (model.back) Action.BACK else Action.APP_ICON

    private fun listener(screen: String, id: String, parkedOnly: Boolean, onAction: (String, String) -> Unit): OnClickListener {
        val click = OnClickListener { onAction(screen, id) }
        return if (parkedOnly) ParkedOnlyOnClickListener.create(click) else click
    }

    private fun action(screen: String, action: CarAction, onAction: (String, String) -> Unit): Action {
        val builder = Action.Builder()
            .setTitle(action.title)
            .setOnClickListener(listener(screen, action.id, action.parkedOnly, onAction))
        if (action.primary) builder.setFlags(Action.FLAG_PRIMARY)
        return builder.build()
    }

    private fun row(row: CarRow): Row {
        val builder = Row.Builder().setTitle(row.title)
        row.text.forEach { builder.addText(it) }
        return builder.build()
    }

    /** A glanceable card: a few rows and, at most, two buttons. Its rows cannot be tapped. */
    private fun pane(model: CarScreenModel, limits: Limits, onAction: (String, String) -> Unit): Template {
        val pane = Pane.Builder()
        if (model.loading) {
            pane.setLoading(true)
        } else {
            model.rows.take(limits.pane).forEach { pane.addRow(row(it)) }
            model.actions.forEach { pane.addAction(action(model.id, it, onAction)) }
            // A pane with neither rows nor buttons is not allowed; say what the screen is instead.
            if (model.rows.isEmpty() && model.actions.isEmpty()) pane.addRow(Row.Builder().setTitle(model.title).build())
        }
        return PaneTemplate.Builder(pane.build())
            .setTitle(model.title)
            .setHeaderAction(header(model))
            .build()
    }

    /** Rows to choose from. A row with an action is tappable; a parked-only one is refused by the car while moving. */
    private fun list(model: CarScreenModel, limits: Limits, onAction: (String, String) -> Unit): Template {
        val template = ListTemplate.Builder()
            .setTitle(model.title)
            .setHeaderAction(header(model))
        if (model.loading) {
            template.setLoading(true)
        } else {
            val items = ItemList.Builder()
            model.rows.take(limits.list).forEach { source ->
                val builder = Row.Builder().setTitle(source.title)
                source.text.forEach { builder.addText(it) }
                if (source.action != null) builder.setOnClickListener(listener(model.id, source.action, source.parkedOnly, onAction))
                items.addItem(builder.build())
            }
            if (model.empty.isNotEmpty()) items.setNoItemsMessage(model.empty)
            template.setSingleList(items.build())
        }
        if (model.actions.isNotEmpty()) {
            val strip = ActionStrip.Builder()
            model.actions.forEach { strip.addAction(action(model.id, it, onAction)) }
            template.setActionStrip(strip.build())
        }
        return template.build()
    }

    /** One sentence, with a spinner while something is happening, and up to two buttons. */
    private fun message(model: CarScreenModel, onAction: (String, String) -> Unit): Template {
        val template = MessageTemplate.Builder(model.message)
            .setTitle(model.title)
            .setHeaderAction(header(model))
        if (model.loading) template.setLoading(true)
        model.actions.forEach { template.addAction(action(model.id, it, onAction)) }
        return template.build()
    }
}
