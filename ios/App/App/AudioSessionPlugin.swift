import Foundation
import Capacitor
import AVFoundation

/// Sets up the audio session for measuring.
/// Measurement mode turns off the system's automatic gain control and voice processing, and
/// defaultToSpeaker keeps playback (the signal generator) on the loudspeaker instead of the
/// earpiece while the microphone is active.
@objc(AudioSessionPlugin)
public class AudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioSessionPlugin"
    public let jsName = "AudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise)
    ]

    @objc func prepare(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothA2DP])
            try session.setActive(true)
            call.resolve(["category": session.category.rawValue, "mode": session.mode.rawValue])
        } catch {
            call.reject("Could not set up the audio session.")
        }
    }
}
