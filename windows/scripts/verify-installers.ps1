<#
Read-only verification of the final Windows NSIS and MSI archives. Never runs
either installer, msiexec, the application, or the embedded service.

Requires the cached WiX dark.exe and a full portable 7z.exe with 7z.dll beside it.
7-Zip may be obtained from the official https://www.7-zip.org/download.html MSI
and extracted with dark.exe -x <workspace-tmp> <7zip.msi> (no installation).
Copy its File/_7z.exe and File/_7z.dll as 7z.exe and 7z.dll into workspace tmp.

Example:
  powershell -NoProfile -File scripts/verify-installers.ps1 `
    -SevenZipPath ../../tmp/installer-verification-tools/portable/7z.exe
All output defaults to workspace tmp/iv. A JSON report is written on success or
failure. The executable payload architecture, not the NSIS x86 bootstrap stub,
must be x64. Missing or stale bundles for the current configured version are errors.
#>
[CmdletBinding()]
param(
    [string]$WindowsRoot = (Join-Path $PSScriptRoot '..'),
    [string]$WorkspaceRoot = (Join-Path $PSScriptRoot '..\..\..'),
    [string]$NsisPath,
    [string]$MsiPath,
    [string]$SevenZipPath,
    [string]$DarkPath = (Join-Path $env:LOCALAPPDATA 'tauri\WixTools314\dark.exe'),
    [string]$OutputDirectory,
    [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Verify([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-SafeRelativePath([string]$RelativePath) {
    $normalized = $RelativePath.Replace('\', '/')
    Assert-Verify (-not [string]::IsNullOrWhiteSpace($normalized)) 'Empty payload path.'
    Assert-Verify (-not [IO.Path]::IsPathRooted($RelativePath) -and $normalized -notmatch '[:\x00-\x1f]') "Absolute or invalid payload path: $RelativePath"
    foreach ($part in $normalized.Split('/')) {
        Assert-Verify ($part -ne '' -and $part -ne '.' -and $part -ne '..') "Unsafe payload path: $RelativePath"
    }
    return $normalized
}

function Assert-WithinRoot([string]$Path, [string]$Root) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    Assert-Verify ($absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) "Output must remain inside $Root"
    return $absolute
}

function Assert-NoPrivatePath([string]$RelativePath) {
    $path = Get-SafeRelativePath $RelativePath
    # Library source files named session.py or provider_credentials.py are public
    # code. Reject actual user state, credentials, configuration and session data.
    Assert-Verify ($path -notmatch '(?i)(^|/)(\.git|\.codex|\.ssh|logs|workspace|backups|storage)(/|$)') "Private state directory in installer: $path"
    Assert-Verify ($path -notmatch '(?i)(^|/)(\.env($|\.)|settings\.json$|config\.json$|credentials?\.(json|txt)$|.*\.(session|session-journal|sqlite|sqlite3|db|log|pem|key)$)') "Private data file in installer: $path"
    return $path
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-EmbeddedPythonPaths([string]$Path) {
    # PowerShell 5 serializes Get-Content's PSDrive/PSProvider metadata attached
    # to line strings, which can recursively expand the entire user profile.
    # Read plain .NET strings and copy their characters before returning them.
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line.Trim() -and -not $line.Trim().StartsWith('#')) {
            [string]::new($line.ToCharArray())
        }
    }
}

function Get-PeArchitecture([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        Assert-Verify ($stream.Length -ge 64 -and $reader.ReadUInt16() -eq 0x5a4d) "Not a PE file: $Path"
        $stream.Position = 0x3c
        $offset = $reader.ReadUInt32()
        Assert-Verify ($offset -le $stream.Length - 6) "Invalid PE offset: $Path"
        $stream.Position = $offset
        Assert-Verify ($reader.ReadUInt32() -eq 0x00004550) "Invalid PE signature: $Path"
        switch ($reader.ReadUInt16()) {
            0x8664 { return 'x64' }
            0x014c { return 'x86' }
            0xaa64 { return 'arm64' }
            default { throw "Unknown PE architecture: $Path" }
        }
    } finally { $reader.Dispose(); $stream.Dispose() }
}

function Get-VersionMetadata([string]$Path) {
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
    return [ordered]@{ product = $info.ProductName; productVersion = $info.ProductVersion; fileVersion = $info.FileVersion }
}

function Get-PeImports([string]$Path) {
    # Parse both regular and delay-load tables without loading native code.
    [void](Get-PeArchitecture $Path)
    $data = [IO.File]::ReadAllBytes($Path)
    $pe = [BitConverter]::ToUInt32($data, 0x3c)
    $sections = [BitConverter]::ToUInt16($data, $pe + 6)
    $optionalSize = [BitConverter]::ToUInt16($data, $pe + 20)
    $optional = $pe + 24
    Assert-Verify ($optional + $optionalSize -le $data.Length) 'Invalid PE optional header.'
    $magic = [BitConverter]::ToUInt16($data, $optional)
    Assert-Verify ($magic -in @(0x20b, 0x10b)) 'Unknown PE optional header.'
    $directoryOffset = $optional + $(if ($magic -eq 0x20b) { 112 } else { 96 })
    $directoryCount = [BitConverter]::ToUInt32($data, $directoryOffset - 4)
    $imageBase = if ($magic -eq 0x20b) { [BitConverter]::ToUInt64($data, $optional + 24) } else { [BitConverter]::ToUInt32($data, $optional + 28) }
    $headerSize = [BitConverter]::ToUInt32($data, $optional + 60)
    $mappings = @()
    for ($index = 0; $index -lt $sections; $index++) {
        $section = $optional + $optionalSize + $index * 40
        Assert-Verify ($section + 40 -le $data.Length) 'Invalid PE section table.'
        $mappings += [PSCustomObject]@{ rva = [BitConverter]::ToUInt32($data, $section + 12); rawSize = [BitConverter]::ToUInt32($data, $section + 16); raw = [BitConverter]::ToUInt32($data, $section + 20) }
    }
    $rvaOffset = {
        param([UInt64]$Rva)
        if ($Rva -lt $headerSize -and $Rva -lt $data.Length) { return [int]$Rva }
        foreach ($mapping in $mappings) {
            if ($Rva -ge $mapping.rva -and $Rva - $mapping.rva -lt $mapping.rawSize) {
                $position = [UInt64]$mapping.raw + $Rva - $mapping.rva
                Assert-Verify ($position -lt $data.Length) 'PE RVA points outside the file.'
                return [int]$position
            }
        }
        throw 'Invalid PE import RVA.'
    }
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($table in @(@{index=1;stride=20;nameField=12}, @{index=13;stride=32;nameField=4})) {
        if ($directoryCount -le $table.index) { continue }
        $directory = $directoryOffset + $table.index * 8
        Assert-Verify ($directory + 8 -le $optional + $optionalSize) 'Invalid PE data directory.'
        $rva = [BitConverter]::ToUInt32($data, $directory)
        $length = [BitConverter]::ToUInt32($data, $directory + 4)
        if ($rva -eq 0) { continue }
        $offset = & $rvaOffset $rva
        $limit = if ($length) { [Math]::Min([long]$length, 65536) } else { 65536 }
        for ($item = 0; $item -lt $limit; $item += $table.stride) {
            $row = $offset + $item
            Assert-Verify ($row + $table.stride -le $data.Length) 'Truncated PE import descriptor.'
            $empty = $true
            for ($byte = 0; $byte -lt $table.stride; $byte++) { if ($data[$row + $byte]) { $empty = $false; break } }
            if ($empty) { break }
            [UInt64]$nameRva = [BitConverter]::ToUInt32($data, $row + $table.nameField)
            if ($nameRva -eq 0) { continue }
            if ($table.index -eq 13 -and ([BitConverter]::ToUInt32($data, $row) -band 1) -eq 0) {
                Assert-Verify ($nameRva -ge $imageBase) 'Invalid VA-based delay import.'
                $nameRva -= $imageBase
            }
            $start = & $rvaOffset $nameRva
            $end = $start
            while ($end -lt $data.Length -and $end - $start -lt 512 -and $data[$end]) { $end++ }
            Assert-Verify ($end -lt $data.Length -and $data[$end] -eq 0) 'Invalid PE import name.'
            $name = [Text.Encoding]::ASCII.GetString($data, $start, $end - $start).ToLowerInvariant()
            Assert-Verify ($name -match '^[a-z0-9_.-]+\.dll$') "Invalid PE DLL name: $name"
            [void]$names.Add($name)
        }
    }
    return @($names | Sort-Object)
}

function Assert-OnlyOsDependencies([string[]]$Imports, [string]$Label) {
    # Checking System32 alone would incorrectly accept redistributables already
    # installed on the build PC. These are Windows OS libraries, not VC runtime.
    $osDlls = @('advapi32.dll','bcrypt.dll','bcryptprimitives.dll','combase.dll','comctl32.dll','crypt32.dll','d3d11.dll','dwmapi.dll','dxgi.dll','gdi32.dll','imm32.dll','iphlpapi.dll','kernel32.dll','kernelbase.dll','msvcrt.dll','ncrypt.dll','netapi32.dll','ntdll.dll','ole32.dll','oleaut32.dll','powrprof.dll','psapi.dll','rpcrt4.dll','secur32.dll','setupapi.dll','shell32.dll','shlwapi.dll','ucrtbase.dll','user32.dll','userenv.dll','uxtheme.dll','version.dll','winhttp.dll','wininet.dll','winmm.dll','wintrust.dll','wldap32.dll','ws2_32.dll','wtsapi32.dll')
    foreach ($name in $Imports) {
        if ($name.StartsWith('api-ms-win-') -or $name.StartsWith('ext-ms-win-')) { continue }
        Assert-Verify ($osDlls -contains $name) "Fresh-PC native dependency is not supplied by Windows: $Label imports $name"
        Assert-Verify (Test-Path -LiteralPath (Join-Path $env:WINDIR "System32/$name") -PathType Leaf) "Windows system library missing: $name"
    }
}

function Assert-FileContent([string]$Path, [long]$Bytes, [string]$Sha256, [string]$Label) {
    Assert-Verify (Test-Path -LiteralPath $Path -PathType Leaf) "Missing payload file: $Label"
    Assert-Verify ((Get-Item -LiteralPath $Path).Length -eq $Bytes) "Size mismatch: $Label"
    Assert-Verify ((Get-Sha256 $Path) -eq $Sha256.ToLowerInvariant()) "SHA256 mismatch: $Label"
}

function Get-MsiRows($Database, [string]$Query, [string[]]$Columns) {
    $view = $Database.OpenView($Query)
    try {
        [void]$view.Execute()
        while ($null -ne ($record = $view.Fetch())) {
            $row = [ordered]@{}
            for ($index = 0; $index -lt $Columns.Count; $index++) { $row[$Columns[$index]] = $record.StringData($index + 1) }
            [PSCustomObject]$row
        }
    } finally { [void]$view.Close() }
}

function Get-MsiDirectoryPath([string]$Id, $Directories, $Visited) {
    if ($Id -eq 'INSTALLDIR') { return '' }
    Assert-Verify ($Directories.ContainsKey($Id)) "Unknown MSI directory: $Id"
    Assert-Verify (-not $Visited.Contains($Id)) "Cyclic MSI directory: $Id"
    [void]$Visited.Add($Id)
    $directory = $Directories[$Id]
    # DefaultDir is target[:source], and long names follow short|long.
    $name = ($directory.Name.Split(':')[0].Split('|') | Select-Object -Last 1)
    $parent = Get-MsiDirectoryPath $directory.Parent $Directories $Visited
    if ($name -eq '.') { return $parent }
    $relative = if ($parent) { "$parent/$name" } else { $name }
    return (Get-SafeRelativePath $relative)
}

function Expand-MsiReadOnly([string]$Archive, [string]$Destination, [string]$WixDark, [string]$ExpectedVersion, [string]$ExpectedProduct) {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($Archive, 0) # MSIDBOPEN_READONLY
    $properties = @{}
    foreach ($row in @(Get-MsiRows $database 'SELECT `Property`,`Value` FROM `Property`' @('Property','Value'))) { $properties[$row.Property] = $row.Value }
    Assert-Verify ($properties['ProductName'] -eq $ExpectedProduct) 'MSI ProductName mismatch.'
    Assert-Verify ($properties['ProductVersion'] -eq $ExpectedVersion) 'MSI ProductVersion mismatch.'
    $template = $database.SummaryInformation(0).Property(7)
    Assert-Verify ($template.Split(';')[0] -eq 'x64') "MSI platform must be x64: $template"
    $directories = @{}
    foreach ($row in @(Get-MsiRows $database 'SELECT `Directory`,`Directory_Parent`,`DefaultDir` FROM `Directory`' @('Id','Parent','Name'))) { $directories[$row.Id] = $row }
    $components = @{}
    foreach ($row in @(Get-MsiRows $database 'SELECT `Component`,`Directory_`,`Attributes` FROM `Component`' @('Id','Directory','Attributes'))) { $components[$row.Id] = $row }
    $files = @(Get-MsiRows $database 'SELECT `File`,`Component_`,`FileName`,`FileSize`,`Version`,`Sequence` FROM `File`' @('Id','Component','Name','Bytes','Version','Sequence'))
    Assert-Verify ($files.Count -ge 2) 'MSI File table is empty.'
    $media = @(Get-MsiRows $database 'SELECT `DiskId`,`LastSequence`,`Cabinet` FROM `Media`' @('Disk','LastSequence','Cabinet'))
    foreach ($row in $media) { Assert-Verify ($row.Cabinet.StartsWith('#')) 'MSI contains an external cabinet; this must be a self-contained installer.' }
    $logical = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $files) {
        Assert-Verify ((Get-SafeRelativePath $file.Id) -notmatch '/') 'Unsafe MSI File ID.'
        Assert-Verify ($components.ContainsKey($file.Component)) "Unknown MSI component: $($file.Component)"
        $component = $components[$file.Component]
        Assert-Verify (([int]$component.Attributes -band 256) -eq 256) "MSI payload component is not 64-bit: $($file.Id)"
        $directory = Get-MsiDirectoryPath $component.Directory $directories ([Collections.Generic.HashSet[string]]::new())
        $name = ($file.Name.Split('|') | Select-Object -Last 1)
        $relative = Get-SafeRelativePath $(if ($directory) { "$directory/$name" } else { $name })
        [void](Assert-NoPrivatePath $relative)
        Assert-Verify ($logical.Add($relative)) "Duplicate MSI destination: $relative"
        $file | Add-Member -NotePropertyName RelativePath -NotePropertyValue $relative
    }
    $raw = Join-Path $Destination 'raw'
    $payload = Join-Path $Destination 'payload'
    New-Item -ItemType Directory -Path $raw, $payload | Out-Null
    $previousTemp = $env:WIX_TEMP
    try {
        $env:WIX_TEMP = $raw
        $output = & $WixDark -nologo -sui -sw -x $raw -o (Join-Path $Destination 'installer.wxs') $Archive 2>&1
        $code = $LASTEXITCODE
        $output | Set-Content -LiteralPath (Join-Path $Destination 'extraction.log') -Encoding utf8
        Assert-Verify ($code -eq 0) "MSI extraction failed (dark.exe exit $code)."
    } finally { $env:WIX_TEMP = $previousTemp }
    $cabFiles = @(Get-ChildItem -LiteralPath (Join-Path $raw 'File') -File)
    Assert-Verify ($cabFiles.Count -eq $files.Count) 'MSI CAB and File table file counts differ.'
    foreach ($file in $files) {
        $source = Join-Path $raw "File/$($file.Id)"
        Assert-Verify (Test-Path -LiteralPath $source -PathType Leaf) "Missing MSI CAB entry: $($file.Id)"
        Assert-Verify ((Get-Item -LiteralPath $source).Length -eq [long]$file.Bytes) "MSI File table size mismatch: $($file.RelativePath)"
        $target = Assert-WithinRoot (Join-Path $payload $file.RelativePath) $payload
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
    }
    $tables = [ordered]@{ product = $properties['ProductName']; version = $properties['ProductVersion']; template = $template; media = $media; files = $files }
    $tables | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $Destination 'msi-tables.json') -Encoding utf8
    return [ordered]@{ payload = $payload; fileCount = $files.Count; template = $template; product = $properties['ProductName']; version = $properties['ProductVersion'] }
}

function Expand-NsisReadOnly([string]$Archive, [string]$Destination, [string]$SevenZip, [string]$ExpectedVersion, [string]$ExpectedProduct) {
    $metadata = Get-VersionMetadata $Archive
    Assert-Verify ($metadata.product -eq $ExpectedProduct) 'NSIS ProductName mismatch.'
    Assert-Verify ($metadata.productVersion -eq $ExpectedVersion -and $metadata.fileVersion -eq $ExpectedVersion) 'NSIS installer version mismatch.'
    $listing = @(& $SevenZip l -slt -ba $Archive 2>&1)
    Assert-Verify ($LASTEXITCODE -eq 0) 'Cannot read NSIS archive.'
    $paths = @($listing | Where-Object { $_ -is [string] -and $_.StartsWith('Path = ') } | ForEach-Object { Get-SafeRelativePath $_.Substring(7) })
    Assert-Verify ($paths.Count -ge 2) 'NSIS archive contains no payload.'
    foreach ($path in $paths) { [void](Assert-NoPrivatePath $path) }
    New-Item -ItemType Directory -Path $Destination | Out-Null
    $listing | Set-Content -LiteralPath (Join-Path (Split-Path $Destination) 'nsis-listing.txt') -Encoding utf8
    $output = & $SevenZip x -y -bb0 "-o$Destination" $Archive 2>&1
    $code = $LASTEXITCODE
    $output | Set-Content -LiteralPath (Join-Path (Split-Path $Destination) 'nsis-extraction.log') -Encoding utf8
    Assert-Verify ($code -eq 0) "NSIS extraction failed (7-Zip exit $code)."
    return [ordered]@{ payload = $Destination; archivedPaths = $paths; stubArchitecture = (Get-PeArchitecture $Archive); metadata = $metadata }
}

function Assert-RuntimeManifest($Manifest) {
    Assert-Verify ($Manifest.service -eq 'coucou-localai-service') 'Runtime manifest service identity mismatch.'
    Assert-Verify ($Manifest.architecture -eq 'x64') 'Runtime manifest architecture must be x64.'
    Assert-Verify ($Manifest.python -match '^3\.12\.') 'Python runtime must be 3.12.'
    Assert-Verify ($Manifest.no_user_config_or_credentials -eq $true) 'Runtime manifest must declare no user configuration or credentials.'
    $entries = @($Manifest.files)
    Assert-Verify ($entries.Count -eq [int]$Manifest.file_count -and $entries.Count -gt 0) 'Runtime manifest file count mismatch.'
    $unique = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $total = 0L
    foreach ($file in $entries) {
        $relative = Assert-NoPrivatePath $file.path
        Assert-Verify ($unique.Add($relative)) "Duplicate runtime manifest path: $relative"
        Assert-Verify ($file.sha256 -match '^[0-9a-fA-F]{64}$' -and [long]$file.bytes -ge 0) "Invalid runtime manifest entry: $relative"
        $total += [long]$file.bytes
    }
    Assert-Verify ($total -eq [long]$Manifest.total_bytes) 'Runtime manifest total bytes mismatch.'
}

function Assert-InstallerPayload([string]$Payload, [string]$SourceRoot, $Manifest, [string]$ExpectedVersion, [string]$ExpectedProduct, [bool]$Nsis) {
    $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $nativeImports = [ordered]@{}
    foreach ($name in @('coucou.exe','coucou-hook.exe')) {
        [void]$expected.Add($name)
        $built = Join-Path $SourceRoot "target/release/$name"
        $extracted = Join-Path $Payload $name
        Assert-FileContent $extracted (Get-Item -LiteralPath $built).Length (Get-Sha256 $built) $name
        Assert-Verify ((Get-PeArchitecture $extracted) -eq 'x64') "$name is not x64."
        $nativeImports[$name] = @(Get-PeImports $extracted)
        Assert-OnlyOsDependencies $nativeImports[$name] $name
    }
    $appMetadata = Get-VersionMetadata (Join-Path $Payload 'coucou.exe')
    Assert-Verify ($appMetadata.product -eq $ExpectedProduct -and $appMetadata.productVersion -eq $ExpectedVersion -and $appMetadata.fileVersion -eq $ExpectedVersion) 'Native app product/version mismatch.'
    [void]$expected.Add('INSTALL-UZ.md')
    $sourceGuide = Join-Path $SourceRoot 'INSTALL-UZ.md'
    Assert-FileContent (Join-Path $Payload 'INSTALL-UZ.md') (Get-Item -LiteralPath $sourceGuide).Length (Get-Sha256 $sourceGuide) 'INSTALL-UZ.md'
    $sourceManifest = Join-Path $SourceRoot 'localai-service/bundle/runtime-manifest.json'
    [void]$expected.Add('localai-service/runtime-manifest.json')
    Assert-FileContent (Join-Path $Payload 'localai-service/runtime-manifest.json') (Get-Item -LiteralPath $sourceManifest).Length (Get-Sha256 $sourceManifest) 'runtime-manifest.json'
    foreach ($file in @($Manifest.files)) {
        $relative = Get-SafeRelativePath "localai-service/$($file.path)"
        [void]$expected.Add($relative)
        Assert-FileContent (Join-Path $Payload $relative) ([long]$file.bytes) $file.sha256 $relative
    }
    $actualFiles = @(Get-ChildItem -LiteralPath $Payload -File -Recurse)
    $pluginCount = 0
    $payloadPrefix = [IO.Path]::GetFullPath($Payload).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    foreach ($file in $actualFiles) {
        [void](Assert-WithinRoot $file.FullName $Payload)
        $relative = Assert-NoPrivatePath $file.FullName.Substring($payloadPrefix.Length)
        if ($Nsis -and ($relative.StartsWith('$PLUGINSDIR/') -or $relative -eq 'uninstall.exe')) { $pluginCount++; continue }
        Assert-Verify ($expected.Contains($relative)) "Unexpected file outside the approved payload: $relative"
    }
    Assert-Verify ($actualFiles.Count - $pluginCount -eq $expected.Count) 'Installer payload file count mismatch.'
    $service = Join-Path $Payload 'localai-service'
    $runtime = Join-Path $service 'runtime'
    $nativeRuntimeFiles = 0
    foreach ($file in @($Manifest.files)) {
        if ($file.path -match '(?i)\.(exe|dll|pyd)$') {
            Assert-Verify ((Get-PeArchitecture (Join-Path $service $file.path)) -eq 'x64') "Runtime binary is not x64: $($file.path)"
            $nativeRuntimeFiles++
        }
    }
    foreach ($relative in @('runtime/python312._pth','runtime/python312.zip','src/service_main.py','src/provider_broker.py','src/provider_credentials.py')) {
        Assert-Verify (Test-Path -LiteralPath (Join-Path $service $relative) -PathType Leaf) "Missing runtime layout requirement: $relative"
    }
    $pythonPaths = @(Get-EmbeddedPythonPaths (Join-Path $runtime 'python312._pth'))
    foreach ($required in @('python312.zip','DLLs','site-packages','site-packages/win32','site-packages/win32/lib','site-packages/pythonwin','site-packages/pywin32_system32','../src')) {
        Assert-Verify ($pythonPaths -contains $required) "Missing embedded Python import path: $required"
    }
    foreach ($entry in $pythonPaths) {
        Assert-Verify ($entry -ne 'import site' -and -not [IO.Path]::IsPathRooted($entry) -and $entry -notmatch ':') "Embedded Python isolation violated: $entry"
        $resolved = Assert-WithinRoot (Join-Path $runtime $entry) $service
        Assert-Verify (Test-Path -LiteralPath $resolved) "Embedded Python import path does not resolve: $entry"
    }
    return [ordered]@{ passed = $true; payloadFiles = $expected.Count; runtimeFiles = [int]$Manifest.file_count; runtimeBytes = [long]$Manifest.total_bytes; x64RuntimeBinaries = $nativeRuntimeFiles; nativeImports = $nativeImports; installerSupportFiles = $pluginCount; appMetadata = $appMetadata; appSha256 = (Get-Sha256 (Join-Path $Payload 'coucou.exe')); hookSha256 = (Get-Sha256 (Join-Path $Payload 'coucou-hook.exe')); guideSha256 = (Get-Sha256 $sourceGuide); runtimeManifestSha256 = (Get-Sha256 $sourceManifest); pythonImportPaths = $pythonPaths; privateFiles = 0 }
}

function Invoke-InstallerVerification {
    $windows = [IO.Path]::GetFullPath($WindowsRoot)
    $workspace = [IO.Path]::GetFullPath($WorkspaceRoot)
    $tmp = Join-Path $workspace 'tmp'
    $config = Get-Content -LiteralPath (Join-Path $windows 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
    Assert-Verify ($config.version -match '^\d+\.\d+\.\d+$') 'The configured installer version must have three numeric components.'
    $version = $config.version
    $product = $config.productName
    if (-not $NsisPath) { $NsisPath = Join-Path $windows "target/release/bundle/nsis/${product}_${version}_x64-setup.exe" }
    if (-not $MsiPath) { $MsiPath = Join-Path $windows "target/release/bundle/msi/${product}_${version}_x64_en-US.msi" }
    if (-not $SevenZipPath) {
        $SevenZipPath = Join-Path $tmp 'installer-verification-tools/portable/7z.exe'
        if (-not (Test-Path -LiteralPath $SevenZipPath)) { $SevenZipPath = Join-Path $env:ProgramFiles '7-Zip/7z.exe' }
    }
    # Managed shells may redirect LOCALAPPDATA while the pre-existing Tauri
    # cache remains in the user's normal profile. Both locations are read-only.
    if (-not (Test-Path -LiteralPath $DarkPath -PathType Leaf)) {
        $profileDark = Join-Path $env:USERPROFILE 'AppData/Local/tauri/WixTools314/dark.exe'
        if (Test-Path -LiteralPath $profileDark -PathType Leaf) { $DarkPath = $profileDark }
    }
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path $tmp ("iv/run-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)) }
    $destination = Assert-WithinRoot $OutputDirectory $tmp
    Assert-Verify (-not (Test-Path -LiteralPath $destination)) 'Use a new output directory; verification never removes existing files.'
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $reportFile = Join-Path $destination 'report.json'
    $report = [ordered]@{ passed = $false; createdUtc = [DateTime]::UtcNow.ToString('o'); expected = [ordered]@{ product = $product; version = $version; architecture = 'x64' }; extractionRoot = $destination; noInstallersExecuted = $true; tools = [ordered]@{ dark = $DarkPath; sevenZip = $SevenZipPath }; artifacts = [ordered]@{}; errors = @() }
    try {
        foreach ($tool in @($DarkPath, $SevenZipPath)) { Assert-Verify (Test-Path -LiteralPath $tool -PathType Leaf) "Required read-only extraction tool missing: $tool" }
        $manifest = Get-Content -LiteralPath (Join-Path $windows 'localai-service/bundle/runtime-manifest.json') -Raw | ConvertFrom-Json
        Assert-RuntimeManifest $manifest
        foreach ($archive in @($NsisPath, $MsiPath)) { Assert-Verify (Test-Path -LiteralPath $archive -PathType Leaf) "Final installer missing: $archive" }
        foreach ($kind in @('nsis','msi')) {
            $archive = [IO.Path]::GetFullPath($(if ($kind -eq 'nsis') { $NsisPath } else { $MsiPath }))
            $artifactReport = [ordered]@{ path = $archive; bytes = (Get-Item -LiteralPath $archive).Length; sha256 = (Get-Sha256 $archive) }
            $report.artifacts[$kind] = $artifactReport
            if ($kind -eq 'nsis') {
                $extraction = Expand-NsisReadOnly $archive (Join-Path $destination 'nsis') $SevenZipPath $version $product
            } else {
                $msiOutput = Join-Path $destination 'msi'
                New-Item -ItemType Directory -Path $msiOutput | Out-Null
                $extraction = Expand-MsiReadOnly $archive $msiOutput $DarkPath $version $product
            }
            $artifactReport.extraction = $extraction
            $artifactReport.verification = Assert-InstallerPayload $extraction.payload $windows $manifest $version $product ($kind -eq 'nsis')
        }
        $report.passed = $true
    } catch {
        $report.errors += $_.Exception.Message
        throw
    } finally {
        $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportFile -Encoding utf8
        Write-Host "Installer verification report: $reportFile"
    }
    Write-Host "PASS: NSIS and MSI $product $version x64; all native and runtime payload hashes match."
}

if (-not $LibraryOnly) { Invoke-InstallerVerification }
