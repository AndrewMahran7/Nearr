//
// NearrSharedAuthModule.swift
//
// Tiny Expo Module that exposes UserDefaults(suiteName: <App Group>) to JS
// from BOTH the main Nearr app target AND the iOS Share Extension target.
//
// Why this exists:
//   The Edge Function `process-share-link` requires a Supabase access token
//   to know which user to save for. The share extension cannot call
//   `supabase.auth.getSession()` because it runs in its own process and
//   has no AsyncStorage access to the host app's session. The accepted
//   iOS pattern is to write the token into the App Group's shared
//   UserDefaults from the host app on auth state change, and read it from
//   the share extension on launch.
//
// The App Group identifier is read from Info.plist key "AppGroup", which
// expo-share-extension auto-populates in BOTH targets at prebuild time
// (value: "group.<bundleId>", e.g. "group.com.nearr.ios").
//
// Security notes:
//   - Only the user's short-lived access token is stored. The Supabase
//     refresh token, anon key, and service role key are NEVER stored here.
//   - UserDefaults inside an App Group container is protected by iOS file
//     protection (Complete Until First Authentication by default). For our
//     threat model (a logged-in device sharing into its own extension)
//     this is appropriate. If we ever need stricter isolation we can move
//     to Keychain access groups.
//

import ExpoModulesCore
import Foundation

public class NearrSharedAuthModule: Module {
  // The single key written / read on both sides.
  private static let TOKEN_KEY = "supabase_access_token"
  // Non-secret bootstrap marker: set once by the host app after its first
  // completed getSession() check (even when signed out) so the extension can
  // tell "first install, host never launched" apart from "signed out".
  private static let INITIALIZED_KEY = "shared_auth_initialized"
  // Non-secret diagnostics: when the last token write happened (epoch ms) and
  // which target performed it (host vs extension). NEVER the token itself.
  private static let LAST_SYNC_KEY = "shared_auth_last_sync_at"
  private static let WRITER_KEY = "shared_auth_writer_target"

  public func definition() -> ModuleDefinition {
    Name("NearrSharedAuth")

    Function("getToken") { () -> String? in
      return Self.defaults()?.string(forKey: Self.TOKEN_KEY)
    }

    Function("setToken") { (token: String?) -> Bool in
      guard let defaults = Self.defaults() else { return false }
      if let token = token, !token.isEmpty {
        defaults.set(token, forKey: Self.TOKEN_KEY)
      } else {
        defaults.removeObject(forKey: Self.TOKEN_KEY)
      }
      // Record non-secret sync metadata for the diagnostic API.
      defaults.set(Date().timeIntervalSince1970 * 1000.0, forKey: Self.LAST_SYNC_KEY)
      defaults.set(Self.writerTarget(), forKey: Self.WRITER_KEY)
      return true
    }

    Function("clearToken") { () -> Bool in
      guard let defaults = Self.defaults() else { return false }
      defaults.removeObject(forKey: Self.TOKEN_KEY)
      return true
    }

    // Mark the bridge initialized. Only ever SETS true; never cleared by
    // sign-out (clearToken leaves this untouched) so the extension keeps
    // showing "sign in" rather than "finish setup" after a sign-out.
    Function("setInitialized") { () -> Bool in
      guard let defaults = Self.defaults() else { return false }
      defaults.set(true, forKey: Self.INITIALIZED_KEY)
      return true
    }

    Function("isInitialized") { () -> Bool in
      return Self.defaults()?.bool(forKey: Self.INITIALIZED_KEY) ?? false
    }

    Function("getAppGroup") { () -> String? in
      return Self.appGroupIdentifier()
    }

    // Non-secret diagnostic snapshot for reporting App Group / token health
    // WITHOUT ever returning or logging the token itself.
    Function("getStatus") { () -> [String: Any] in
      return Self.status()
    }
  }

  // MARK: - helpers

  /// Returns the App Group identifier configured at build time by
  /// expo-share-extension. Falls back to nil so callers can degrade to
  /// the open_app deep-link flow.
  private static func appGroupIdentifier() -> String? {
    guard
      let value = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String,
      !value.isEmpty
    else {
      NSLog("[NearrSharedAuth] AppGroup key missing from Info.plist")
      return nil
    }
    return value
  }

  private static func defaults() -> UserDefaults? {
    guard let group = appGroupIdentifier() else { return nil }
    guard let defaults = UserDefaults(suiteName: group) else {
      NSLog("[NearrSharedAuth] failed to open UserDefaults for suite \(group)")
      return nil
    }
    return defaults
  }

  /// host vs extension: extensions bundle as `*.appex`.
  private static func writerTarget() -> String {
    return Bundle.main.bundleURL.pathExtension == "appex" ? "extension" : "host"
  }

  /// Non-secret status snapshot. Numeric/optional fields use NSNull() (=> null
  /// in JS). NEVER includes the token value.
  private static func status() -> [String: Any] {
    guard let defaults = defaults() else {
      return [
        "appGroupAccessible": false,
        "initialized": false,
        "tokenPresent": false,
        "tokenStructurallyValid": false,
        "tokenExpiresAt": NSNull(),
        "lastSyncAt": NSNull(),
        "writerTarget": NSNull(),
        "errorCode": "app_group_unavailable",
      ]
    }
    let token = defaults.string(forKey: TOKEN_KEY)
    let hasToken = (token?.isEmpty == false)
    let decoded: (valid: Bool, expMs: Double?) = hasToken ? decodeJwt(token!) : (false, nil)
    let lastSync = defaults.object(forKey: LAST_SYNC_KEY) as? Double
    let writer = defaults.string(forKey: WRITER_KEY)
    return [
      "appGroupAccessible": true,
      "initialized": defaults.bool(forKey: INITIALIZED_KEY),
      "tokenPresent": hasToken,
      "tokenStructurallyValid": decoded.valid,
      "tokenExpiresAt": decoded.expMs.map { $0 as Any } ?? NSNull(),
      "lastSyncAt": lastSync.map { $0 as Any } ?? NSNull(),
      "writerTarget": writer.map { $0 as Any } ?? NSNull(),
      "errorCode": NSNull(),
    ]
  }

  /// Decode a JWT's `exp` WITHOUT verifying the signature and WITHOUT exposing
  /// any other claim. Returns whether it is a structurally valid 3-part JWT and
  /// its expiry in epoch milliseconds (nil when absent).
  private static func decodeJwt(_ token: String) -> (valid: Bool, expMs: Double?) {
    let parts = token.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else { return (false, nil) }
    var b64 = String(parts[1])
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while b64.count % 4 != 0 { b64 += "=" }
    guard
      let data = Data(base64Encoded: b64),
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return (false, nil)
    }
    if let exp = obj["exp"] as? Double { return (true, exp * 1000.0) }
    if let expInt = obj["exp"] as? Int { return (true, Double(expInt) * 1000.0) }
    return (true, nil)
  }
}
