require 'json'

# Podspec for the local `nearr-shared-auth` Expo module.
#
# WHY THIS FILE MATTERS (root cause of "Open Nearr once to finish setup"):
#   expo-modules-autolinking discovers native Apple modules by globbing
#   `*/*.podspec` under each module directory (see
#   node_modules/expo-modules-autolinking/build/platforms/apple.js). Without a
#   podspec, `resolveModuleAsync` returns null, so NearrSharedAuthModule.swift
#   is NEVER compiled into the host OR the share-extension target. At runtime
#   `requireOptionalNativeModule('NearrSharedAuth')` then returns null and every
#   getToken/setToken/setInitialized/getStatus call is a silent no-op — the App
#   Group bridge never writes the token or the `shared_auth_initialized` marker,
#   so the extension reads initialized=false forever and shows the setup prompt
#   on every share. This podspec makes the Swift compile into BOTH targets
#   (the extension Podfile uses `use_expo_modules!` and does NOT exclude this
#   package), which is what actually wires the App Group.
#
# The pod name (NearrSharedAuth) only needs to be unique; the JS lookup key is
# the Swift `Name("NearrSharedAuth")` in the ModuleDefinition, not the pod name.

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'NearrSharedAuth'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'Nearr'
  s.homepage       = 'https://nearr.app'
  s.platforms      = { :ios => '13.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compiler flags
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
