import UIKit
import React
import AVFoundation
// switch to UniformTypeIdentifiers, once 14.0 is the minimum deploymnt target on expo (currently 13.4 in expo v50)
import MobileCoreServices
// if react native firebase is installed, we import and configure it
#if canImport(FirebaseCore)
import FirebaseCore
#endif
#if canImport(FirebaseAuth)
import FirebaseAuth
#endif

class ShareExtensionViewController: UIViewController {

  private static var sharedBridge: RCTBridge?
  private weak var rootView: RCTRootView?
  private let loadingIndicator = UIActivityIndicatorView(style: .large)
  private let loadingLabel = UILabel()
  private let compactSurfaceView = UIView()
  private var payloadFailureView: UIView?
  private var compactSurfaceHeightConstraint: NSLayoutConstraint?
  private var observerTokens: [NSObjectProtocol] = []
  private var isFinishing = false
  private var hasOpenedHost = false
  private var didCleanUp = false
  private var lastHostURL: URL?
  private let invocationId = "s_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  private static let shareTraceKey = "share_extension_trace_v1"
  private static let maximumTraceEvents = 64
  private static let payloadDeadline: TimeInterval = 8

  // The share host owns the outer presentation controller. preferredContentSize
  // is therefore a best-effort request, while this bottom-anchored surface is
  // the deterministic visible Nearr UI when a host keeps full-height bounds.
  private lazy var compactPresentationHeight: CGFloat = {
    let configured = Bundle.main.object(forInfoDictionaryKey: "ShareExtensionHeight") as? NSNumber
    let configuredHeight = configured.map { CGFloat(truncating: $0) } ?? 360
    return min(max(configuredHeight, 340), 380)
  }()
  private let maximumAccessibleHeight: CGFloat = 420
  private let compactSurfaceColor = UIColor(
    red: 13.0 / 255.0,
    green: 13.0 / 255.0,
    blue: 15.0 / 255.0,
    alpha: 1
  )

  private var requestedCompactHeight: CGFloat {
    if traitCollection.preferredContentSizeCategory.isAccessibilityCategory {
      return min(compactPresentationHeight + 60, maximumAccessibleHeight)
    }
    return compactPresentationHeight
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    applyCompactLayout()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    applyCompactLayout()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
      applyCompactLayout()
    }
  }

  private func applyCompactLayout() {
    let requestedHeight = requestedCompactHeight
    let availableHeight = view.bounds.height
    let visibleHeight = availableHeight > 0 ? min(requestedHeight, availableHeight) : requestedHeight
    if compactSurfaceHeightConstraint?.constant != visibleHeight {
      compactSurfaceHeightConstraint?.constant = visibleHeight
    }

    let target = CGSize(width: view.bounds.width, height: requestedHeight)
    if preferredContentSize != target {
      preferredContentSize = target
    }
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    recordTrace("extension_invoked")
    view.backgroundColor = .clear
    view.isOpaque = false
    setupCompactSurface()
    applyCompactLayout()
    setupLoadingIndicator()
    setupNotificationCenterObserver()
#if canImport(FirebaseCore)
    if Bundle.main.object(forInfoDictionaryKey: "WithFirebase") as? Bool ?? false {
      FirebaseApp.configure()
    }
#endif
    initializeReactNativeBridgeIfNeeded()
    loadReactNativeContent()
  }

  private func setupCompactSurface() {
    compactSurfaceView.backgroundColor = compactSurfaceColor
    compactSurfaceView.isOpaque = true
    compactSurfaceView.translatesAutoresizingMaskIntoConstraints = false
    compactSurfaceView.layer.cornerRadius = 24
    compactSurfaceView.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
    compactSurfaceView.clipsToBounds = true
    view.addSubview(compactSurfaceView)

    let heightConstraint = compactSurfaceView.heightAnchor.constraint(equalToConstant: requestedCompactHeight)
    compactSurfaceHeightConstraint = heightConstraint
    NSLayoutConstraint.activate([
      compactSurfaceView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      compactSurfaceView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      compactSurfaceView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      heightConstraint
    ])
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // we need to clean up when the view is closed via a swipe
    cleanupAfterClose()
  }

  func close() {
    guard !isFinishing else { return }
    isFinishing = true
    self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    // we need to clean up when the view is closed via the close() method in react native
    cleanupAfterClose()
  }

  private func setupLoadingIndicator() {
    loadingIndicator.color = UIColor(red: 1, green: 107.0 / 255.0, blue: 0, alpha: 1)
    compactSurfaceView.addSubview(loadingIndicator)
    loadingIndicator.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      loadingIndicator.centerXAnchor.constraint(equalTo: compactSurfaceView.centerXAnchor),
      loadingIndicator.centerYAnchor.constraint(equalTo: compactSurfaceView.centerYAnchor, constant: -18)
    ])
    loadingLabel.text = "Preparing share…"
    loadingLabel.textColor = .white
    loadingLabel.font = .systemFont(ofSize: 16, weight: .semibold)
    loadingLabel.textAlignment = .center
    loadingLabel.translatesAutoresizingMaskIntoConstraints = false
    compactSurfaceView.addSubview(loadingLabel)
    NSLayoutConstraint.activate([
      loadingLabel.topAnchor.constraint(equalTo: loadingIndicator.bottomAnchor, constant: 14),
      loadingLabel.leadingAnchor.constraint(equalTo: compactSurfaceView.leadingAnchor, constant: 24),
      loadingLabel.trailingAnchor.constraint(equalTo: compactSurfaceView.trailingAnchor, constant: -24)
    ])
    loadingIndicator.startAnimating()
  }

  private func showLoadingState() {
    payloadFailureView?.removeFromSuperview()
    payloadFailureView = nil
    loadingIndicator.isHidden = false
    loadingLabel.isHidden = false
    loadingIndicator.startAnimating()
  }

  private func showPayloadFailure(_ reason: String) {
    loadingIndicator.stopAnimating()
    loadingIndicator.isHidden = true
    loadingLabel.isHidden = true
    rootView?.isHidden = true
    payloadFailureView?.removeFromSuperview()

    let container = UIStackView()
    container.axis = .vertical
    container.alignment = .fill
    container.spacing = 12
    container.translatesAutoresizingMaskIntoConstraints = false

    let title = UILabel()
    let isBundleFailure = reason.contains("bundle") || reason == "bridge_unavailable"
    title.text = isBundleFailure ? "Couldn’t start Nearr" : "Couldn’t read this share"
    title.textColor = .white
    title.font = .systemFont(ofSize: 21, weight: .bold)
    title.textAlignment = .center

    let body = UILabel()
    body.text = isBundleFailure
      ? "Nearr’s share extension couldn’t load. Try again or close this window."
      : (reason == "timeout"
        ? "Instagram didn’t finish sending the link. Try again or close this window."
        : "Nearr couldn’t find a link in this item. Try again or close this window.")
    body.textColor = UIColor(white: 0.72, alpha: 1)
    body.font = .systemFont(ofSize: 15)
    body.textAlignment = .center
    body.numberOfLines = 0

    let retry = UIButton(type: .system)
    retry.setTitle("Try again", for: .normal)
    retry.setTitleColor(.white, for: .normal)
    retry.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
    retry.backgroundColor = UIColor(red: 1, green: 107.0 / 255.0, blue: 0, alpha: 1)
    retry.layer.cornerRadius = 14
    retry.heightAnchor.constraint(equalToConstant: 52).isActive = true
    retry.addTarget(self, action: #selector(retryPayloadExtraction), for: .touchUpInside)

    let closeButton = UIButton(type: .system)
    closeButton.setTitle("Close", for: .normal)
    closeButton.setTitleColor(UIColor(white: 0.82, alpha: 1), for: .normal)
    closeButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    closeButton.heightAnchor.constraint(equalToConstant: 44).isActive = true
    closeButton.addTarget(self, action: #selector(closeFromNativeFailure), for: .touchUpInside)

    [title, body, retry, closeButton].forEach { container.addArrangedSubview($0) }
    compactSurfaceView.addSubview(container)
    NSLayoutConstraint.activate([
      container.leadingAnchor.constraint(equalTo: compactSurfaceView.leadingAnchor, constant: 24),
      container.trailingAnchor.constraint(equalTo: compactSurfaceView.trailingAnchor, constant: -24),
      container.centerYAnchor.constraint(equalTo: compactSurfaceView.centerYAnchor)
    ])
    payloadFailureView = container
  }

  @objc private func retryPayloadExtraction() {
    recordTrace("extension_payload_started", detail: "retry")
    loadingLabel.text = "Preparing share…"
    showLoadingState()
    initializeReactNativeBridgeIfNeeded()
    loadReactNativeContent(isRetry: true)
  }

  @objc private func closeFromNativeFailure() {
    close()
  }

  private func initializeReactNativeBridgeIfNeeded() {
    if ShareExtensionViewController.sharedBridge == nil {
      guard let jsCodeLocation = self.jsCodeLocation() else {
        recordTrace("extension_js_bundle_failure", detail: "bundle_missing")
        showPayloadFailure("bundle_missing")
        return
      }
      recordTrace(
        "extension_js_bundle_started",
        detail: jsCodeLocation.isFileURL ? "embedded" : "metro"
      )
      ShareExtensionViewController.sharedBridge = RCTBridge(bundleURL: jsCodeLocation, moduleProvider: nil, launchOptions: nil)
    }
  }

  private func openHostApp(path: String?) {
    guard !hasOpenedHost, !isFinishing else { return }
    hasOpenedHost = true
    guard let scheme = Bundle.main.object(forInfoDictionaryKey: "HostAppScheme") as? String else {
      recordTrace("extension_open_host_failure", detail: "missing_scheme")
      hasOpenedHost = false
      showHostOpenFailure()
      return
    }
    var urlComponents = URLComponents()
    urlComponents.scheme = scheme
    urlComponents.host = ""

    if let path = path {
      let pathComponents = path.split(separator: "?", maxSplits: 1)
      let pathWithoutQuery = String(pathComponents[0])
      let queryString = pathComponents.count > 1 ? String(pathComponents[1]) : nil

      // Preserve the query that JavaScript already percent-encoded. Rebuilding
      // URLQueryItems from those encoded values escapes '%' a second time and
      // turns `https%3A...` into `https%253A...`, so Expo Router receives a
      // non-URL after its normal single decode.
      if let queryString = queryString {
        urlComponents.percentEncodedQuery = queryString
      }

      let pathWithSlashEnsured = pathWithoutQuery.hasPrefix("/") ? pathWithoutQuery : "/\(pathWithoutQuery)"
      urlComponents.path = pathWithSlashEnsured
    }

    guard let url = urlComponents.url else {
      recordTrace("extension_open_host_failure", detail: "invalid_deep_link")
      hasOpenedHost = false
      showHostOpenFailure()
      return
    }
    lastHostURL = url
    recordTrace("extension_open_host_attempt")
    openURL(url) { [weak self] opened in
      DispatchQueue.main.async {
        guard let self = self else { return }
        if opened {
          self.recordTrace("extension_open_host_success")
          self.close()
        } else {
          self.recordTrace("extension_open_host_failure", detail: "open_rejected")
          self.hasOpenedHost = false
          self.showHostOpenFailure()
        }
      }
    }
  }

  private func openURL(_ url: URL, completion: @escaping (Bool) -> Void) {
    var responder: UIResponder? = self
    while responder != nil {
      if let application = responder as? UIApplication {
        if #available(iOS 18.0, *) {
          application.open(url, options: [:], completionHandler: completion)
          return
        } else {
          let dispatched = application.perform(
            #selector(UIApplication.open(_:options:completionHandler:)),
            with: url,
            with: [:]
          ) != nil
          completion(dispatched)
          return
        }
      }
      responder = responder?.next
    }
    completion(false)
  }

  private func showHostOpenFailure() {
    loadingIndicator.stopAnimating()
    loadingIndicator.isHidden = true
    loadingLabel.isHidden = true
    rootView?.isHidden = true
    payloadFailureView?.removeFromSuperview()

    let container = UIStackView()
    container.axis = .vertical
    container.alignment = .fill
    container.spacing = 12
    container.translatesAutoresizingMaskIntoConstraints = false

    let title = UILabel()
    title.text = "Couldn’t open Nearr"
    title.textColor = .white
    title.font = .systemFont(ofSize: 21, weight: .bold)
    title.textAlignment = .center

    let body = UILabel()
    body.text = "Try opening Nearr again, or close this window and keep browsing."
    body.textColor = UIColor(white: 0.72, alpha: 1)
    body.font = .systemFont(ofSize: 15)
    body.textAlignment = .center
    body.numberOfLines = 0

    let retry = UIButton(type: .system)
    retry.setTitle("Try again", for: .normal)
    retry.setTitleColor(.white, for: .normal)
    retry.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
    retry.backgroundColor = UIColor(red: 1, green: 107.0 / 255.0, blue: 0, alpha: 1)
    retry.layer.cornerRadius = 14
    retry.heightAnchor.constraint(equalToConstant: 52).isActive = true
    retry.addTarget(self, action: #selector(retryHostOpen), for: .touchUpInside)

    let closeButton = UIButton(type: .system)
    closeButton.setTitle("Close", for: .normal)
    closeButton.setTitleColor(UIColor(white: 0.82, alpha: 1), for: .normal)
    closeButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    closeButton.heightAnchor.constraint(equalToConstant: 44).isActive = true
    closeButton.addTarget(self, action: #selector(closeFromNativeFailure), for: .touchUpInside)

    [title, body, retry, closeButton].forEach { container.addArrangedSubview($0) }
    compactSurfaceView.addSubview(container)
    NSLayoutConstraint.activate([
      container.leadingAnchor.constraint(equalTo: compactSurfaceView.leadingAnchor, constant: 24),
      container.trailingAnchor.constraint(equalTo: compactSurfaceView.trailingAnchor, constant: -24),
      container.centerYAnchor.constraint(equalTo: compactSurfaceView.centerYAnchor)
    ])
    payloadFailureView = container
  }

  @objc private func retryHostOpen() {
    guard let url = lastHostURL else {
      showHostOpenFailure()
      return
    }
    payloadFailureView?.removeFromSuperview()
    payloadFailureView = nil
    loadingLabel.text = "Opening Nearr…"
    showLoadingState()
    hasOpenedHost = true
    recordTrace("extension_open_host_attempt", detail: "retry")
    openURL(url) { [weak self] opened in
      DispatchQueue.main.async {
        guard let self = self else { return }
        if opened {
          self.recordTrace("extension_open_host_success", detail: "retry")
          self.close()
        } else {
          self.recordTrace("extension_open_host_failure", detail: "retry_rejected")
          self.hasOpenedHost = false
          self.showHostOpenFailure()
        }
      }
    }
  }

  private func loadReactNativeContent(isRetry: Bool = false) {
    if !isRetry { recordTrace("extension_payload_started") }
    getShareData { [weak self] sharedData, outcome in
      guard let self = self else { return }

      guard let sharedData = sharedData else {
        self.recordTrace(
          outcome == "timeout" ? "extension_payload_timeout" : "extension_payload_failure",
          detail: outcome
        )
        self.showPayloadFailure(outcome)
        return
      }

      guard let bridge = ShareExtensionViewController.sharedBridge else {
        self.recordTrace("extension_payload_failure", detail: "bridge_unavailable")
        self.showPayloadFailure("bridge_unavailable")
        return
      }

      var initialProperties = sharedData
      initialProperties["invocationId"] = self.invocationId
      initialProperties["payloadOutcome"] = outcome
      if outcome == "timeout" {
        self.recordTrace("extension_payload_timeout", detail: "partial_url")
      }
      self.recordTrace("extension_url_extracted", detail: self.payloadRepresentation(sharedData))

      DispatchQueue.main.async {
        if self.rootView == nil {
          let rootView = RCTRootView(bridge: bridge, moduleName: "shareExtension", initialProperties: initialProperties)
          self.configureRootView(rootView)
          self.rootView = rootView
        } else {
          // Update existing rootView with new data
          self.rootView?.appProperties = initialProperties
          self.rootView?.isHidden = false
        }
        self.loadingIndicator.stopAnimating()
        self.loadingIndicator.isHidden = true
        self.loadingLabel.isHidden = true
      }
    }
  }

  private func setupNotificationCenterObserver() {
    let closeToken = NotificationCenter.default.addObserver(forName: NSNotification.Name("close"), object: nil, queue: nil) { [weak self] _ in
      DispatchQueue.main.async {
        self?.close()
      }
    }

    let openToken = NotificationCenter.default.addObserver(forName: NSNotification.Name("openHostApp"), object: nil, queue: nil) { [weak self] notification in
      DispatchQueue.main.async {
        if let userInfo = notification.userInfo {
          if let path = userInfo["path"] as? String {
            self?.openHostApp(path: path)
          }
        }
      }
    }
    let jsLoadedToken = NotificationCenter.default.addObserver(
      forName: NSNotification.Name("RCTJavaScriptDidLoadNotification"),
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.recordTrace("extension_js_bundle_loaded")
    }
    let jsFailureToken = NotificationCenter.default.addObserver(
      forName: NSNotification.Name("RCTJavaScriptDidFailToLoadNotification"),
      object: nil,
      queue: nil
    ) { [weak self] _ in
      DispatchQueue.main.async {
        self?.recordTrace("extension_js_bundle_failure", detail: "load_failed")
        self?.rootView?.removeFromSuperview()
        self?.rootView = nil
        ShareExtensionViewController.sharedBridge?.invalidate()
        ShareExtensionViewController.sharedBridge = nil
        self?.showPayloadFailure("bundle_load_failed")
      }
    }
    observerTokens = [closeToken, openToken, jsLoadedToken, jsFailureToken]
  }

  private func cleanupAfterClose() {
    guard !didCleanUp else { return }
    didCleanUp = true
    rootView?.removeFromSuperview()
    rootView = nil
    payloadFailureView?.removeFromSuperview()
    payloadFailureView = nil
    ShareExtensionViewController.sharedBridge?.invalidate()
    ShareExtensionViewController.sharedBridge = nil
    observerTokens.forEach { NotificationCenter.default.removeObserver($0) }
    observerTokens.removeAll()
  }

  private func configureRootView(_ rootView: RCTRootView) {
    rootView.backgroundColor = .clear
    rootView.isOpaque = false
    rootView.translatesAutoresizingMaskIntoConstraints = false
    compactSurfaceView.addSubview(rootView)
    NSLayoutConstraint.activate([
      rootView.leadingAnchor.constraint(equalTo: compactSurfaceView.leadingAnchor),
      rootView.trailingAnchor.constraint(equalTo: compactSurfaceView.trailingAnchor),
      rootView.topAnchor.constraint(equalTo: compactSurfaceView.topAnchor),
      rootView.bottomAnchor.constraint(equalTo: compactSurfaceView.bottomAnchor)
    ])
    applyCompactLayout()
  }

  private func jsCodeLocation() -> URL? {
    // A share extension is a separate process and this target deliberately
    // excludes expo-dev-client. Always run the bundle shipped inside the appex;
    // a development build must not depend on the host app's Metro session to
    // render its first frame. A missing bundle becomes visible failure UI.
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }

  private func firstHTTPURL(in value: Any) -> String? {
    if let url = value as? URL {
      let scheme = url.scheme?.lowercased()
      return scheme == "http" || scheme == "https" ? url.absoluteString : nil
    }
    if let text = value as? String {
      guard let detector = try? NSDataDetector(
        types: NSTextCheckingResult.CheckingType.link.rawValue
      ) else { return nil }
      let range = NSRange(text.startIndex..<text.endIndex, in: text)
      for match in detector.matches(in: text, options: [], range: range) {
        guard let url = match.url else { continue }
        let scheme = url.scheme?.lowercased()
        if scheme == "http" || scheme == "https" { return url.absoluteString }
      }
      return nil
    }
    if let dictionary = value as? NSDictionary {
      for nested in dictionary.allValues {
        if let url = firstHTTPURL(in: nested) { return url }
      }
      return nil
    }
    if let array = value as? NSArray {
      for nested in array {
        if let url = firstHTTPURL(in: nested) { return url }
      }
    }
    return nil
  }

  private func payloadRepresentation(_ sharedData: [String: Any]) -> String {
    if let representation = sharedData["urlRepresentation"] as? String {
      return representation
    }
    if sharedData["url"] != nil { return "public_url" }
    if sharedData["text"] != nil { return "plain_text" }
    if sharedData["preprocessingResults"] != nil { return "property_list" }
    return "unknown"
  }

  private func recordTrace(_ event: String, detail: String? = nil) {
#if DEBUG
    guard
      let appGroup = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String,
      let defaults = UserDefaults(suiteName: appGroup)
    else {
      NSLog("[NearrShareTrace] id=%@ event=%@ detail=%@", invocationId, event, detail ?? "none")
      return
    }
    var events = defaults.array(forKey: Self.shareTraceKey) as? [[String: Any]] ?? []
    var entry: [String: Any] = [
      "invocationId": invocationId,
      "event": String(event.prefix(64)),
      "timestamp": Date().timeIntervalSince1970 * 1000.0,
      "process": "extension"
    ]
    if let detail = detail,
       detail.range(of: "^[a-zA-Z0-9_.:-]{1,64}$", options: .regularExpression) != nil {
      entry["detail"] = detail
    }
    events.append(entry)
    if events.count > Self.maximumTraceEvents {
      events.removeFirst(events.count - Self.maximumTraceEvents)
    }
    defaults.set(events, forKey: Self.shareTraceKey)
    defaults.synchronize()
    NSLog("[NearrShareTrace] id=%@ event=%@ detail=%@", invocationId, event, detail ?? "none")
#endif
  }

  private func getShareData(completion: @escaping ([String: Any]?, String) -> Void) {
    guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
      completion(nil, "missing_input")
      return
    }

    var sharedItems: [String: Any] = [:]
    var didFinish = false
    var sawProviderFailure = false
    var supportedProviderCount = 0

    let group = DispatchGroup()

    let fileManager = FileManager.default

    for item in extensionItems {
      for provider in item.attachments ?? [] {
        let hasURL = provider.hasItemConformingToTypeIdentifier(kUTTypeURL as String)
        let hasPropertyList = provider.hasItemConformingToTypeIdentifier(kUTTypePropertyList as String)
        let hasText = provider.hasItemConformingToTypeIdentifier(kUTTypeText as String)

        // Load every textual representation the provider advertises. Instagram
        // can expose both public.url and public.plain-text; if one callback
        // fails or stalls, the other can still yield the Reel URL by deadline.
        if hasURL {
          supportedProviderCount += 1
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeURL as String, options: nil) { (urlItem, error) in
            DispatchQueue.main.async {
              if error != nil { sawProviderFailure = true }
              let loadedURL = (urlItem as? URL) ?? (urlItem as? NSURL).map { $0 as URL }
              if let sharedURL = loadedURL {
                if sharedURL.isFileURL {
                  if sharedItems["files"] == nil {
                    sharedItems["files"] = [String]()
                  }
                  if var fileArray = sharedItems["files"] as? [String] {
                    fileArray.append(sharedURL.absoluteString)
                    sharedItems["files"] = fileArray
                  }
                } else {
                  sharedItems["url"] = sharedURL.absoluteString
                }
              } else if let urlItem = urlItem,
                        let extracted = self.firstHTTPURL(in: urlItem) {
                sharedItems["url"] = extracted
              }
              group.leave()
            }
          }
        }
        if hasPropertyList {
          supportedProviderCount += 1
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypePropertyList as String, options: nil) { (item, error) in
            DispatchQueue.main.async {
              if error != nil { sawProviderFailure = true }
              if let itemDict = item as? NSDictionary {
                let results = itemDict[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary
                  ?? itemDict
                sharedItems["preprocessingResults"] = results
                if sharedItems["url"] == nil, let extracted = self.firstHTTPURL(in: results) {
                  sharedItems["url"] = extracted
                  sharedItems["urlRepresentation"] = "property_list"
                }
              }
              group.leave()
            }
          }
        }
        if hasText {
          supportedProviderCount += 1
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeText as String, options: nil) { (textItem, error) in
            DispatchQueue.main.async {
              if error != nil { sawProviderFailure = true }
              if let text = (textItem as? String) ?? (textItem as? NSString).map({ String($0) }) {
                sharedItems["text"] = text
                if sharedItems["url"] == nil, let extracted = self.firstHTTPURL(in: text) {
                  sharedItems["url"] = extracted
                  sharedItems["urlRepresentation"] = "plain_text"
                }
              }
              group.leave()
            }
          }
        }
        if !hasURL && !hasPropertyList && !hasText && provider.hasItemConformingToTypeIdentifier(kUTTypeImage as String) {
          supportedProviderCount += 1
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeImage as String, options: nil) { (imageItem, error) in
            DispatchQueue.main.async {
              defer { group.leave() }
              if error != nil { sawProviderFailure = true }

              // Ensure the array exists
              if sharedItems["images"] == nil {
                sharedItems["images"] = [String]()
              }

              guard let appGroup = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String else {
                print("Could not find AppGroup in info.plist")
                return
              }

              guard let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
                print("Could not set up file manager container URL for app group")
                return
              }

              if let imageUri = imageItem as? NSURL {
                if let tempFilePath = imageUri.path {
                  let fileExtension = imageUri.pathExtension ?? "jpg"
                  let fileName = UUID().uuidString + "." + fileExtension

                  let sharedDataUrl = containerUrl.appendingPathComponent("sharedData")

                  if !fileManager.fileExists(atPath: sharedDataUrl.path) {
                    do {
                      try fileManager.createDirectory(at: sharedDataUrl, withIntermediateDirectories: true)
                    } catch {
                      print("Failed to create sharedData directory: \(error)")
                    }
                  }

                  let persistentURL = sharedDataUrl.appendingPathComponent(fileName)

                  do {
                    try fileManager.copyItem(atPath: tempFilePath, toPath: persistentURL.path)
                    if var videoArray = sharedItems["images"] as? [String] {
                      videoArray.append(persistentURL.absoluteString)
                      sharedItems["images"] = videoArray
                    }
                  } catch {
                    print("Failed to copy image: \(error)")
                  }
                }
              } else if let image = imageItem as? UIImage {
                // Handle UIImage if needed (e.g., save to disk and get the file path)
                if let imageData = image.jpegData(compressionQuality: 1.0) {
                  let fileName = UUID().uuidString + ".jpg"

                  let sharedDataUrl = containerUrl.appendingPathComponent("sharedData")

                  if !fileManager.fileExists(atPath: sharedDataUrl.path) {
                    do {
                      try fileManager.createDirectory(at: sharedDataUrl, withIntermediateDirectories: true)
                    } catch {
                      print("Failed to create sharedData directory: \(error)")
                    }
                  }

                  let persistentURL = sharedDataUrl.appendingPathComponent(fileName)

                  do {
                    try imageData.write(to: persistentURL)
                    if var imageArray = sharedItems["images"] as? [String] {
                      imageArray.append(persistentURL.absoluteString)
                      sharedItems["images"] = imageArray
                    }
                  } catch {
                    print("Failed to save image: \(error)")
                  }
                }
              } else {
                print("imageItem is not a recognized type")
              }
            }
          }
        } else if !hasURL && !hasPropertyList && !hasText && provider.hasItemConformingToTypeIdentifier(kUTTypeMovie as String) {
          supportedProviderCount += 1
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeMovie as String, options: nil) { (videoItem, error) in
            DispatchQueue.main.async {
              defer { group.leave() }
              if error != nil { sawProviderFailure = true }
              print("videoItem type: \(type(of: videoItem))")

              // Ensure the array exists
              if sharedItems["videos"] == nil {
                sharedItems["videos"] = [String]()
              }

              guard let appGroup = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String else {
                print("Could not find AppGroup in info.plist")
                return
              }

              guard let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
                print("Could not set up file manager container URL for app group")
                return
              }

              // Check if videoItem is NSURL
              if let videoUri = videoItem as? NSURL {
                if let tempFilePath = videoUri.path {
                  let fileExtension = videoUri.pathExtension ?? "mov"
                  let fileName = UUID().uuidString + "." + fileExtension

                  let sharedDataUrl = containerUrl.appendingPathComponent("sharedData")

                  if !fileManager.fileExists(atPath: sharedDataUrl.path) {
                    do {
                      try fileManager.createDirectory(at: sharedDataUrl, withIntermediateDirectories: true)
                    } catch {
                      print("Failed to create sharedData directory: \(error)")
                    }
                  }

                  let persistentURL = sharedDataUrl.appendingPathComponent(fileName)

                  do {
                    try fileManager.copyItem(atPath: tempFilePath, toPath: persistentURL.path)
                    if var videoArray = sharedItems["videos"] as? [String] {
                      videoArray.append(persistentURL.path)
                      sharedItems["videos"] = videoArray
                    }
                  } catch {
                    print("Failed to copy video: \(error)")
                  }
                }
              }
              // Check if videoItem is NSData
              else if let videoData = videoItem as? NSData {
                let fileExtension = "mov" // Using mov as default type extension
                let fileName = UUID().uuidString + "." + fileExtension

                let sharedDataUrl = containerUrl.appendingPathComponent("sharedData")

                if !fileManager.fileExists(atPath: sharedDataUrl.path) {
                  do {
                    try fileManager.createDirectory(at: sharedDataUrl, withIntermediateDirectories: true)
                  } catch {
                    print("Failed to create sharedData directory: \(error)")
                  }
                }

                let persistentURL = sharedDataUrl.appendingPathComponent(fileName)

                do {
                  try videoData.write(to: persistentURL)
                  if var videoArray = sharedItems["videos"] as? [String] {
                    videoArray.append(persistentURL.path)
                    sharedItems["videos"] = videoArray
                  }
                } catch {
                  print("Failed to save video: \(error)")
                }
              }
              // Check if videoItem is AVAsset
              else if let asset = videoItem as? AVAsset {
                let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough)

                let fileExtension = "mov" // Using mov as default type extension
                let fileName = UUID().uuidString + "." + fileExtension

                let sharedDataUrl = containerUrl.appendingPathComponent("sharedData")

                if !fileManager.fileExists(atPath: sharedDataUrl.path) {
                  do {
                    try fileManager.createDirectory(at: sharedDataUrl, withIntermediateDirectories: true)
                  } catch {
                    print("Failed to create sharedData directory: \(error)")
                  }
                }

                let persistentURL = sharedDataUrl.appendingPathComponent(fileName)

                exportSession?.outputURL = persistentURL
                exportSession?.outputFileType = .mov
                exportSession?.exportAsynchronously {
                  switch exportSession?.status {
                  case .completed:
                    if var videoArray = sharedItems["videos"] as? [String] {
                      videoArray.append(persistentURL.absoluteString)
                      sharedItems["videos"] = videoArray
                    }
                  case .failed:
                    print("Failed to export video: \(String(describing: exportSession?.error))")
                  default:
                    break
                  }
                }
              } else {
                print("videoItem is not a recognized type")
              }
            }
          }
        }
      }
    }

    func finish(_ reason: String) {
      guard !didFinish else { return }
      didFinish = true
      if let directURL = sharedItems["url"] as? String,
         self.firstHTTPURL(in: directURL) != nil {
        if sharedItems["urlRepresentation"] == nil {
          sharedItems["urlRepresentation"] = "public_url"
        }
        completion(sharedItems, reason)
        return
      }
      completion(nil, reason)
    }

    group.notify(queue: .main) {
      let reason = supportedProviderCount == 0
        ? "unsupported"
        : (sawProviderFailure ? "provider_failed" : "complete")
      finish(reason)
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + Self.payloadDeadline) {
      finish("timeout")
    }
  }
}
