package expo.modules.autosaarthicar

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.car.app.CarAppService
import androidx.car.app.validation.HostValidator
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/** What Android Auto reads before it ever opens a screen: the manifest, and who may connect. */
@RunWith(RobolectricTestRunner::class)
class ServiceTest {

    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun theManifestOffersACarAppServiceInTheIotCategory() {
        val intent = Intent(CarAppService.SERVICE_INTERFACE).addCategory(CarAppService.CATEGORY_IOT_APP).setPackage(context.packageName)
        val found = context.packageManager.queryIntentServices(intent, PackageManager.GET_META_DATA)
        assertEquals(listOf(AutoSaarthiCarService::class.java.name), found.map { it.serviceInfo.name })
        assertTrue("the host binds to it from another app", found.single().serviceInfo.exported)
    }

    @Test
    fun theManifestSaysTheAppDrawsItsScreensWithTemplates() {
        val app = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        val descriptor = app.metaData.getInt("com.google.android.gms.car.application")
        assertNotEquals("the automotive_app_desc.xml resource", 0, descriptor)
        val xml = context.resources.getXml(descriptor)
        val uses = mutableListOf<String>()
        while (xml.eventType != android.content.res.XmlResourceParser.END_DOCUMENT) {
            if (xml.eventType == android.content.res.XmlResourceParser.START_TAG && xml.name == "uses") {
                uses += xml.getAttributeValue(null, "name")
            }
            xml.next()
        }
        assertEquals(listOf("template"), uses)
    }

    @Test
    fun theManifestAsksForCarApiLevelSixBecauseThatIsWhatTheIotCategoryNeeds() {
        val app = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        assertEquals(6, app.metaData.getInt("androidx.car.app.minCarApiLevel"))
    }

    private fun service(debuggable: Boolean): AutoSaarthiCarService {
        val service = Robolectric.setupService(AutoSaarthiCarService::class.java)
        service.applicationInfo.flags = if (debuggable) {
            service.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        } else {
            service.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
        }
        return service
    }

    @Test
    fun aDebugBuildAcceptsAnyHostSoTheDesktopHeadUnitCanReachIt() {
        assertSame(HostValidator.ALLOW_ALL_HOSTS_VALIDATOR, service(debuggable = true).createHostValidator())
    }

    @Test
    fun aReleaseBuildAcceptsOnlyTheListedHosts() {
        val validator = service(debuggable = false).createHostValidator()
        assertNotEquals(HostValidator.ALLOW_ALL_HOSTS_VALIDATOR, validator)
        assertFalse("Google's car hosts are on the list", validator.allowedHosts.isEmpty())
        assertTrue(
            "Android Auto itself must be allowed",
            validator.allowedHosts.keys.contains("com.google.android.projection.gearhead"),
        )
    }

    @Test
    fun theServiceStartsASessionThatTalksToTheSharedBridge() {
        val session = service(debuggable = true).onCreateSession()
        assertNotNull(session)
        assertTrue(session is AutoSaarthiCarSession)
    }
}
