import Foundation
import Capacitor
import StoreKit

/// The one-time "Pro" unlock, a non-consumable in-app purchase handled with StoreKit 2.
/// The web app reaches this through window.PocketRTANative (js/native-bridge.js).
/// Ownership is always read from the App Store's entitlements, so a refund locks Pro again.
@objc(ProPlugin)
public class ProPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ProPlugin"
    public let jsName = "Pro"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProduct", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isPro", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    /// Must match the product created in App Store Connect.
    private let productID = "com.balancedigitalllc.pocketrta.pro"
    private var updates: Task<Void, Never>?

    public override func load() {
        // Purchases that finish outside the app (Ask to Buy approval, another device) arrive here.
        updates = Task.detached {
            for await result in Transaction.updates {
                if case .verified(let transaction) = result { await transaction.finish() }
            }
        }
    }

    deinit { updates?.cancel() }

    private func owned() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == productID,
               transaction.revocationDate == nil {
                return true
            }
        }
        return false
    }

    @objc func getProduct(_ call: CAPPluginCall) {
        Task {
            do {
                if let product = try await Product.products(for: [productID]).first {
                    call.resolve(["price": product.displayPrice])
                } else {
                    call.resolve([:])
                }
            } catch {
                call.reject("Could not load the product.")
            }
        }
    }

    @objc func isPro(_ call: CAPPluginCall) {
        Task { call.resolve(["pro": await owned()]) }
    }

    @objc func buy(_ call: CAPPluginCall) {
        Task {
            do {
                guard let product = try await Product.products(for: [productID]).first else {
                    call.reject("The product is not available.")
                    return
                }
                switch try await product.purchase() {
                case .success(let verification):
                    if case .verified(let transaction) = verification {
                        await transaction.finish()
                        call.resolve(["pro": true])
                    } else {
                        call.resolve(["pro": false])
                    }
                case .userCancelled, .pending:
                    call.resolve(["pro": false])
                @unknown default:
                    call.resolve(["pro": false])
                }
            } catch {
                call.reject("The purchase did not complete.")
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                call.resolve(["pro": await owned()])
            } catch {
                call.reject("Could not reach the App Store.")
            }
        }
    }
}
