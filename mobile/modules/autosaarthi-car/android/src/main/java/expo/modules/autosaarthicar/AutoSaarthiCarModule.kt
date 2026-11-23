package expo.modules.autosaarthicar

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What the app's JavaScript sees of the car (src/car/native.ts).
 *
 * Functions send whole screens to the car and answer whether a car was there to take them. Events
 * tell the JavaScript a car connected or went, what was tapped, and which screens are open. The
 * module holds nothing itself: [CarBridge] does, so it outlives a reload of the JavaScript.
 */
class AutoSaarthiCarModule : Module() {
    private var sink: Sink? = null

    override fun definition() = ModuleDefinition {
        Name("AutoSaarthiCar")

        Events("onConnected", "onDisconnected", "onAction", "onStack")

        OnCreate {
            val mine = Sink { event, body -> sendEvent(event, body) }
            sink = mine
            CarBridge.shared.attach(mine)
        }

        OnDestroy {
            sink?.let { CarBridge.shared.detach(it) }
            sink = null
        }

        Function("isConnected") { CarBridge.shared.isConnected() }

        Function("root") { json: String -> CarBridge.shared.root(CarModel.parse(json)) }

        Function("push") { json: String -> CarBridge.shared.push(CarModel.parse(json)) }

        Function("update") { json: String -> CarBridge.shared.update(CarModel.parse(json)) }

        Function("pop") { toId: String? -> CarBridge.shared.pop(toId) }
    }
}
