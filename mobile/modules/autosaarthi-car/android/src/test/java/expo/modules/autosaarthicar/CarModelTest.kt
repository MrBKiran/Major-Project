package expo.modules.autosaarthicar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The JSON the JavaScript sends: what is accepted, what is trimmed, and what is refused with a reason. */
@RunWith(RobolectricTestRunner::class)
class CarModelTest {

    private fun refused(json: String): String =
        assertThrows(InvalidModelException::class.java) { CarModel.parse(json) }.message.orEmpty()

    @Test
    fun readsAWholePane() {
        val model = CarModel.parse(
            """{"id":"status","kind":"pane","title":"Bolero · MH12AB1001",
               "rows":[{"title":"Your water pump is wearing out","text":["Urgent · 5 days","About 5 days of driving left, on current use."]}],
               "actions":[{"id":"book","title":"Book a service","primary":true,"parkedOnly":true}]}""",
        )
        assertEquals("status", model.id)
        assertEquals(CarKind.PANE, model.kind)
        assertEquals("Bolero · MH12AB1001", model.title)
        assertEquals(2, model.rows.single().text.size)
        assertEquals(CarAction("book", "Book a service", primary = true, parkedOnly = true), model.actions.single())
        assertFalse(model.loading)
        assertFalse(model.back)
    }

    @Test
    fun readsAListWhoseRowsCanBeTapped() {
        val model = CarModel.parse(
            """{"id":"slots","kind":"list","title":"Pick a time","back":true,"empty":"No times are free right now.",
               "rows":[{"title":"Mon 23 Nov, 9:00 am","text":["Pune Central"],"action":"slot:0","parkedOnly":true}]}""",
        )
        assertEquals(CarKind.LIST, model.kind)
        assertTrue(model.back)
        assertEquals("slot:0", model.rows.single().action)
        assertTrue(model.rows.single().parkedOnly)
        assertEquals("No times are free right now.", model.empty)
    }

    @Test
    fun aRowWithoutAnActionIsNotTappable() {
        val model = CarModel.parse("""{"id":"s","kind":"list","title":"T","rows":[{"title":"Only a line"}]}""")
        assertNull(model.rows.single().action)
        assertTrue(model.rows.single().text.isEmpty())
    }

    @Test
    fun readsAMessageWithASpinner() {
        val model = CarModel.parse("""{"id":"m","kind":"message","title":"AutoSaarthi","message":"Booking…","loading":true}""")
        assertEquals(CarKind.MESSAGE, model.kind)
        assertTrue(model.loading)
    }

    @Test
    fun keepsTwoLinesOfTextAndTwoButtons() {
        // The car's templates hold no more; extra lines and buttons are dropped, not an error.
        val model = CarModel.parse(
            """{"id":"p","kind":"pane","title":"T",
               "rows":[{"title":"r","text":["one","two","three"]}],
               "actions":[{"id":"a","title":"A"},{"id":"b","title":"B"},{"id":"c","title":"C"}]}""",
        )
        assertEquals(listOf("one", "two"), model.rows.single().text)
        assertEquals(listOf("a", "b"), model.actions.map { it.id })
    }

    @Test
    fun dropsBlankTextLines() {
        val model = CarModel.parse("""{"id":"p","kind":"pane","title":"T","rows":[{"title":"r","text":["", "  ", "kept"]}]}""")
        assertEquals(listOf("kept"), model.rows.single().text)
    }

    @Test
    fun refusesWhatItCannotDraw() {
        assertTrue(refused("not json").contains("not valid JSON"))
        assertTrue(refused("""{"kind":"pane","title":"T"}""").contains("id"))
        assertTrue(refused("""{"id":"${"x".repeat(65)}","kind":"pane","title":"T"}""").contains("id"))
        assertTrue(refused("""{"id":"a","kind":"carousel","title":"T"}""").contains("unknown kind"))
        assertTrue(refused("""{"id":"a","kind":"pane"}""").contains("title"))
        assertTrue(refused("""{"id":"a","kind":"message","title":"T"}""").contains("message"))
        assertTrue(refused("""{"id":"a","kind":"list","title":"T","rows":[{"text":["x"]}]}""").contains("row 0"))
        assertTrue(refused("""{"id":"a","kind":"pane","title":"T","actions":[{"id":"x"}]}""").contains("action 0"))
        assertTrue(refused("""{"id":"a","kind":"pane","title":"T","rows":[1]}""").contains("not an object"))
    }
}
