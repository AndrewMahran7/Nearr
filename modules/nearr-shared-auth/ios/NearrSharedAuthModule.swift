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
}
