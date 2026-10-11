param([string]$RequestPath, [switch]$Probe)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
    $taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await-Winrt($Operation, [Type]$ResultType) {
        $task = $taskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
        if (-not $task.Wait(30000)) { throw 'winrt_operation_timeout' }
        return $task.GetAwaiter().GetResult()
    }
    $dll = Join-Path $env:windir 'System32/Windows.Media.Ocr.dll'
    $engineInfo = [ordered]@{
        name='Windows.Media.Ocr'; os_build=[Environment]::OSVersion.Version.ToString()
        languages=@([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object {$_.LanguageTag})
        max_image_dimension=[Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        dll_version=if(Test-Path -LiteralPath $dll){(Get-Item -LiteralPath $dll).VersionInfo.FileVersion}else{$null}
        dll_sha256=if(Test-Path -LiteralPath $dll){(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}
        word_confidence_available=$false; network_used=$false
    }
    if ($Probe) { $engineInfo | ConvertTo-Json -Depth 8 -Compress; exit 0 }
    $request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($request.language -notin $engineInfo.languages) { throw 'ocr_language_unavailable' }
    $language = [Windows.Globalization.Language]::new([string]$request.language)
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    if ($null -eq $engine) { throw 'ocr_engine_unavailable' }
    $root = [IO.Path]::GetFullPath([string]$request.input_root).TrimEnd('\') + '\'
    if (@($request.frames).Count -gt 32) { throw 'ocr_frame_budget_exceeded' }
    $items = @()
    foreach ($frame in $request.frames) {
        if ([string]$frame.relative_path -notmatch '^frames/\d{3,}\.jpg$') { throw 'unsafe_neutral_frame_path' }
        $filePath = [IO.Path]::GetFullPath((Join-Path $root ([string]$frame.relative_path)))
        if (-not $filePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { throw 'unsafe_neutral_frame_path' }
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $file = Await-Winrt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($filePath)) ([Windows.Storage.StorageFile])
        $stream = Await-Winrt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $bitmap = $null
        try {
            $decoder = Await-Winrt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmap = Await-Winrt ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
            if ($bitmap.PixelWidth -gt $engineInfo.max_image_dimension -or $bitmap.PixelHeight -gt $engineInfo.max_image_dimension) { throw 'ocr_frame_dimension_exceeded' }
            $result = Await-Winrt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $lines = @($result.Lines | ForEach-Object {
                $line = $_
                [ordered]@{text=$line.Text; words=@($line.Words | ForEach-Object {
                    [ordered]@{text=$_.Text; box=[ordered]@{x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height};confidence=$null}
                })}
            })
            $watch.Stop()
            $items += [ordered]@{relative_path=[string]$frame.relative_path;text=$result.Text;text_angle=$result.TextAngle;width=$bitmap.PixelWidth;height=$bitmap.PixelHeight;lines=$lines;elapsed_ms=$watch.Elapsed.TotalMilliseconds}
        } finally {
            if($null -ne $bitmap){$bitmap.Dispose()}
            $stream.Dispose()
        }
    }
    [ordered]@{engine=$engineInfo;language=$engine.RecognizerLanguage.LanguageTag;items=$items} | ConvertTo-Json -Depth 12 -Compress
} catch {
    [Console]::Error.WriteLine('local_winrt_ocr_failed: ' + $_.Exception.GetType().Name)
    exit 1
}
