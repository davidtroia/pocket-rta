import UIKit
import Capacitor

/// Registers the app's own native plugins with the Capacitor bridge.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ProPlugin())
        bridge?.registerPluginInstance(AudioSessionPlugin())
    }
}
