//
// ShareViewController.swift
// NearrShareExtension
//
// SCAFFOLD — not wired into the Expo build by default.
//
// Purpose:
//   Receive a URL shared from TikTok / Instagram / any app, persist it into
//   the App Group's UserDefaults under key `lastSharedUrl`, then deep-link
//   into the host app via the custom URL scheme so the app picks the URL up
//   on next foreground.
//
// Flow:
//   1. User taps Share in TikTok/Instagram and picks "Nearr".
//   2. iOS instantiates this view controller.
//   3. We read the first NSExtensionItem with a public.url attachment.
//   4. We write the URL string into the shared App Group UserDefaults.
//   5. We open `nearr://share?url=<encoded>` to wake the host app.
//   6. The host app's deep-link handler routes to /share?url=...
//   7. We call completeRequest to dismiss the share sheet.
//
// Notes:
//   - App Group ID must match the one declared in:
//       * native/share-extension/NearrShareExtension.entitlements
//       * the host app's entitlements (added via the config plugin)
//   - The custom URL scheme must match `expo.scheme` in app.json ("nearr").
//   - This file lives outside ios/ on purpose: `expo prebuild` overwrites
//     ios/ but leaves native/ alone. The withShareExtension config plugin
//     is responsible for copying these into ios/ during prebuild.
//

import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    // Must match the App Group configured for both targets.
    private let appGroupId = "group.com.nearr.app"
    // Must match expo.scheme in app.json.
    private let hostScheme = "nearr"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        extractSharedUrl { [weak self] url in
            guard let self = self else { return }
            if let url = url {
                self.persist(url: url)
                self.openHostApp(with: url)
            }
            self.dismissSheet()
        }
    }

    // MARK: - Extract

    private func extractSharedUrl(completion: @escaping (URL?) -> Void) {
        guard
            let extensionItems = extensionContext?.inputItems as? [NSExtensionItem]
        else {
            completion(nil)
            return
        }

        let urlTypeIdentifier = UTType.url.identifier
        let textTypeIdentifier = UTType.plainText.identifier

        for item in extensionItems {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(urlTypeIdentifier) {
                    provider.loadItem(forTypeIdentifier: urlTypeIdentifier, options: nil) { (data, _) in
                        if let url = data as? URL {
                            completion(url)
                        } else if let str = data as? String, let url = URL(string: str) {
                            completion(url)
                        } else {
                            completion(nil)
                        }
                    }
                    return
                }
                if provider.hasItemConformingToTypeIdentifier(textTypeIdentifier) {
                    provider.loadItem(forTypeIdentifier: textTypeIdentifier, options: nil) { (data, _) in
                        if let str = data as? String,
                           let match = Self.firstUrl(in: str) {
                            completion(match)
                        } else {
                            completion(nil)
                        }
                    }
                    return
                }
            }
        }
        completion(nil)
    }

    private static func firstUrl(in text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = detector?.firstMatch(in: text, options: [], range: range),
              let url = match.url else { return nil }
        return url
    }

    // MARK: - Persist + open

    private func persist(url: URL) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
        defaults.set(url.absoluteString, forKey: "lastSharedUrl")
        defaults.set(Date().timeIntervalSince1970, forKey: "lastSharedAt")
    }

    private func openHostApp(with url: URL) {
        guard let encoded = url.absoluteString
                .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let target = URL(string: "\(hostScheme)://share?url=\(encoded)")
        else { return }

        // Walk responder chain to find a UIApplication-like object that
        // exposes openURL: (extensions can't call UIApplication.shared).
        var responder: UIResponder? = self
        while responder != nil {
            if let app = responder as? UIApplication {
                app.perform(#selector(openURL(_:)), with: target)
                return
            }
            responder = responder?.next
        }
    }

    @objc private func openURL(_ url: URL) -> Bool { return false }

    private func dismissSheet() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
