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
  private let compactSurfaceView = UIView()
  private var compactSurfaceHeightConstraint: NSLayoutConstraint?
  private var observerTokens: [NSObjectProtocol] = []
  private var isFinishing = false
  private var hasOpenedHost = false
  private var didCleanUp = false

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
    view.backgroundColor = .clear
    view.isOpaque = false
    setupCompactSurface()
    applyCompactLayout()
    setupLoadingIndicator()
#if canImport(FirebaseCore)
    if Bundle.main.object(forInfoDictionaryKey: "WithFirebase") as? Bool ?? false {
      FirebaseApp.configure()
    }
#endif
    initializeReactNativeBridgeIfNeeded()
    loadReactNativeContent()
    setupNotificationCenterObserver()
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
      loadingIndicator.centerYAnchor.constraint(equalTo: compactSurfaceView.centerYAnchor)
    ])
    loadingIndicator.startAnimating()
  }

  private func initializeReactNativeBridgeIfNeeded() {
    if ShareExtensionViewController.sharedBridge == nil {
      let jsCodeLocation = self.jsCodeLocation()
      ShareExtensionViewController.sharedBridge = RCTBridge(bundleURL: jsCodeLocation, moduleProvider: nil, launchOptions: nil)
    }
  }

  private func openHostApp(path: String?) {
    guard !hasOpenedHost, !isFinishing else { return }
    hasOpenedHost = true
    guard let scheme = Bundle.main.object(forInfoDictionaryKey: "HostAppScheme") as? String else {
      self.close()
      return
    }
    var urlComponents = URLComponents()
    urlComponents.scheme = scheme
    urlComponents.host = ""

    if let path = path {
      let pathComponents = path.split(separator: "?", maxSplits: 1)
      let pathWithoutQuery = String(pathComponents[0])
      let queryString = pathComponents.count > 1 ? String(pathComponents[1]) : nil

      // Parse and set query items
      if let queryString = queryString {
        let queryItems = queryString.split(separator: "&").map { queryParam -> URLQueryItem in
          let paramComponents = queryParam.split(separator: "=", maxSplits: 1)
          let name = String(paramComponents[0])
          let value = paramComponents.count > 1 ? String(paramComponents[1]) : nil
          return URLQueryItem(name: name, value: value)
        }
        urlComponents.queryItems = queryItems
      }

      let pathWithSlashEnsured = pathWithoutQuery.hasPrefix("/") ? pathWithoutQuery : "/\(pathWithoutQuery)"
      urlComponents.path = pathWithSlashEnsured
    }

    guard let url = urlComponents.url else {
      self.close()
      return
    }
    openURL(url)
    self.close()
  }

  @objc @discardableResult private func openURL(_ url: URL) -> Bool {
    var responder: UIResponder? = self
    while responder != nil {
      if let application = responder as? UIApplication {
        if #available(iOS 18.0, *) {
          application.open(url, options: [:], completionHandler: nil)
          return true
        } else {
          return application.perform(#selector(UIApplication.open(_:options:completionHandler:)), with: url, with: [:]) != nil
        }
      }
      responder = responder?.next
    }
    return false
  }

  private func loadReactNativeContent() {
    getShareData { [weak self] sharedData in
      guard let self = self, let bridge = ShareExtensionViewController.sharedBridge else { return }

      DispatchQueue.main.async {
        if self.rootView == nil {
          let rootView = RCTRootView(bridge: bridge, moduleName: "shareExtension", initialProperties: sharedData)
          self.configureRootView(rootView)
          self.rootView = rootView
        } else {
          // Update existing rootView with new data
          self.rootView?.appProperties = sharedData
        }
        self.loadingIndicator.stopAnimating()
        self.loadingIndicator.removeFromSuperview()
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
    observerTokens = [closeToken, openToken]
  }

  private func cleanupAfterClose() {
    guard !didCleanUp else { return }
    didCleanUp = true
    rootView?.removeFromSuperview()
    rootView = nil
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
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index.share")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

  private func getShareData(completion: @escaping ([String: Any]?) -> Void) {
    guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
      completion(nil)
      return
    }

    var sharedItems: [String: Any] = [:]

    let group = DispatchGroup()

    let fileManager = FileManager.default

    for item in extensionItems {
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(kUTTypeURL as String) {
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeURL as String, options: nil) { (urlItem, error) in
            DispatchQueue.main.async {
              if let sharedURL = urlItem as? URL {
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
              }
              group.leave()
            }
          }
        } else if provider.hasItemConformingToTypeIdentifier(kUTTypePropertyList as String) {
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypePropertyList as String, options: nil) { (item, error) in
            DispatchQueue.main.async {
              if let itemDict = item as? NSDictionary,
                 let results = itemDict[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary {
                sharedItems["preprocessingResults"] = results
              }
              group.leave()
            }
          }
        } else if provider.hasItemConformingToTypeIdentifier(kUTTypeText as String) {
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeText as String, options: nil) { (textItem, error) in
            DispatchQueue.main.async {
              if let text = textItem as? String {
                sharedItems["text"] = text
              }
              group.leave()
            }
          }
        } else if provider.hasItemConformingToTypeIdentifier(kUTTypeImage as String) {
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeImage as String, options: nil) { (imageItem, error) in
            DispatchQueue.main.async {

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
              group.leave()
            }
          }
        } else if provider.hasItemConformingToTypeIdentifier(kUTTypeMovie as String) {
          group.enter()
          provider.loadItem(forTypeIdentifier: kUTTypeMovie as String, options: nil) { (videoItem, error) in
            DispatchQueue.main.async {
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
              group.leave()
            }
          }
        }
      }
    }

    group.notify(queue: .main) {
      completion(sharedItems.isEmpty ? nil : sharedItems)
    }
  }
}
